import fs from "node:fs";
import { runFixer, runReviewer, type Review } from "./agent.js";
import type { Architecture } from "./arch.js";
import { run } from "./exec.js";
import { regressions, type GateResults } from "./gates.js";
import type { Finding } from "./types.js";

export interface Candidate {
  dir: string;
  after: GateResults;
  remaining: Finding[];
  agentRuns: string[];
  /** Lines the fixer added or removed, lockfiles excluded. Smaller is easier to review. */
  size: number;
  /** Gates hold and no breaking findings remain. */
  ok: boolean;
  /** The internal reviewer's last verdict, when the architecture has one. */
  review?: Review;
  cost: number;
}

export interface FixContext {
  baseline: GateResults;
  /** Gates after the deterministic fixes, before any fixer. */
  after: GateResults;
  /** Findings for the fixer's first attempt. */
  findings: Finding[];
  failingOutput: (after: GateResults) => string;
  gates: (dir: string) => GateResults;
  /** Breaking findings left after a fix; empty means the code is done. */
  breaks: (dir: string) => Finding[];
  /** Shell commands equivalent to the gates, relative to the repo root. */
  checks?: string[];
}

const LOCKFILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/;
const git = (dir: string, ...args: string[]) =>
  run("git", ["-c", "user.name=shim", "-c", "user.email=shim@localhost", ...args], dir);

/**
 * The fixer is not deterministic, so run several independent fixers on copies of the repo and let the
 * gates (and the reviewer, if any) choose. Agents run side by side; gates run one at a time (they are
 * sync), which keeps memory sane.
 */
export async function fixInParallel(dir: string, arch: Architecture, ctx: FixContext): Promise<Candidate[]> {
  return Promise.all(Array.from({ length: arch.candidates }, (_, i) => fixCandidate(dir, `${dir}.cand${i}`, arch, ctx)));
}

async function fixCandidate(dir: string, cdir: string, arch: Architecture, ctx: FixContext): Promise<Candidate> {
  fs.rmSync(cdir, { recursive: true, force: true });
  run("cp", ["-a", dir, cdir], ".");
  // Snapshot so the candidate's own diff can be measured, then undone before review.
  git(cdir, "add", "-A");
  git(cdir, "commit", "-q", "--no-verify", "-m", "shim: before fixer");

  let after = ctx.after;
  let remaining = ctx.findings;
  let review: Review | undefined;
  let cost = 0;
  const agentRuns: string[] = [];
  const passing = () => !regressions(ctx.baseline, after).length && !remaining.length;
  const fix = async (reviewIssues?: string[]) => {
    const first = !agentRuns.length;
    const res = await runFixer(cdir, { findings: first ? ctx.findings : [], failures: ctx.failingOutput(after), reviewIssues, checks: ctx.checks }, arch);
    agentRuns.push(res.text ?? res.output);
    cost += res.cost ?? 0;
    after = ctx.gates(cdir);
    remaining = ctx.breaks(cdir);
  };

  for (let attempt = 1; attempt <= arch.attempts; attempt++) {
    await fix();
    if (passing()) break;
  }
  if (arch.review) {
    for (let round = 0; passing(); round++) {
      review = await runReviewer(cdir, arch.reviewerRules, arch.reviewerModel);
      cost += review.cost;
      if (review.approve || round >= arch.reviewRounds) break;
      await fix(review.issues);
    }
  }

  git(cdir, "add", "-A");
  const size = git(cdir, "diff", "--cached", "--numstat", "HEAD").output.split("\n")
    .map((l) => l.split("\t"))
    .filter(([, , file]) => file && !LOCKFILES.test(file))
    .reduce((sum, [a, d]) => sum + (Number(a) || 0) + (Number(d) || 0), 0);
  git(cdir, "reset", "-q", "--soft", "HEAD~1");
  git(cdir, "reset", "-q");
  return { dir: cdir, after, remaining, agentRuns, size, ok: passing(), review, cost };
}

/**
 * Approved passing candidates first, then unreviewed passing ones, then the least-broken failures.
 * Within a tier, `smallest` prefers the smallest diff; `first` keeps launch order.
 */
export function rank(cands: Candidate[], baseline: GateResults, selection: Architecture["selection"] = "smallest"): Candidate[] {
  const score = (c: Candidate) => [
    c.ok ? (c.review && !c.review.approve ? 1 : 0) : 2,
    regressions(baseline, c.after).length,
    c.remaining.length,
    selection === "smallest" ? c.size : 0,
  ];
  return [...cands].sort((a, b) => {
    const [x, y] = [score(a), score(b)];
    const i = x.findIndex((v, k) => v !== y[k]);
    return i < 0 ? 0 : x[i]! - y[i]!;
  });
}

/** Make the chosen candidate the repo, and drop the rest. */
export function adopt(dir: string, chosen: Candidate, all: Candidate[]) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(chosen.dir, dir);
  for (const c of all) if (c !== chosen) fs.rmSync(c.dir, { recursive: true, force: true });
}
