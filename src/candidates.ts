import fs from "node:fs";
import { runFixer, runReviewer, type Review } from "./agent.js";
import type { Architecture } from "./arch.js";
import { getMigration, type Migration } from "./migrations.js";
import { copyRepo, rmTree, unshareNodeModules } from "./copy.js";
import { costUnpriced, run } from "./exec.js";
import { regressions, type GateResults } from "./gates.js";
import { FORBIDDEN_MODEL_RE } from "./evolve-guard.js";
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
  /** null when the backend is unpriced (dsh or ANTHROPIC_BASE_URL). */
  cost: number | null;
}

export interface FixContext {
  baseline: GateResults;
  /** Gates after the deterministic fixes, before any fixer. */
  after: GateResults;
  /** Findings for the fixer's first attempt. */
  findings: Finding[];
  failingOutput: (after: GateResults) => string;
  /** Run the gates on a candidate; install only when its dependencies changed. */
  gates: (dir: string, install: boolean) => GateResults;
  /** Breaking findings left after a fix; empty means the code is done. */
  breaks: (dir: string) => Finding[];
  /** Shell commands equivalent to the gates, relative to the repo root. */
  checks?: string[];
  /** The release's own notes, handed to the fixer when the upgrade came from a watched release. */
  changeNotes?: string;
  /** Which migration the fixer and reviewer run under. */
  m?: Migration;
}

const MANIFESTS = /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|pnpm-workspace\.yaml)$/;
const LOCKFILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/;
const git = (dir: string, ...args: string[]) =>
  run("git", ["-c", "user.name=shim", "-c", "user.email=shim@localhost", ...args], dir);

/**
 * The fixer is not deterministic, so run several independent fixers on copies of the repo and let the
 * gates (and the reviewer, if any) choose. Agents run side by side; gates run one at a time (they are
 * sync), which keeps memory sane.
 *
 * Round-robin: with arch.fixerModels, candidate i fixes with that model (cheapest first, falling
 * back to arch.fixerModel). Without escalate the whole rotation runs in parallel; with escalate
 * it runs cheapest-first, stopping at the first passing candidate, so the cheaper model pays only
 * for the runs it can finish.
 */
export async function fixCandidates(dir: string, arch: Architecture, ctx: FixContext): Promise<Candidate[]> {
  // Thunks, not promises: an escalated run must not start a candidate (or spend a model) until
  // the previous one has failed.
  const all = Array.from({ length: arch.candidates }, (_, i) => () => {
    const model = arch.fixerModels ? arch.fixerModels[i % arch.fixerModels.length] : undefined;
    // The Fable/Mythos ban on every agent role extends to a rotated fixer: arch.json is an input.
    if (model && FORBIDDEN_MODEL_RE.test(model))
      throw new Error(`fixerModels contains "${model}", which is banned (fable/mythos)`);
    return fixCandidate(dir, `${dir}.cand${i}`, arch, ctx, model);
  });
  if (!arch.escalate) return Promise.all(all.map((start) => start()));
  const out: Candidate[] = [];
  for (const start of all) {
    out.push(await start());
    if (out[out.length - 1]!.ok) break; // a cheap candidate passed; the costlier models never run.
  }
  return out;
}

/** The parallel form, the V2 mechanism. */
export async function fixInParallel(dir: string, arch: Architecture, ctx: FixContext): Promise<Candidate[]> {
  return fixCandidates(dir, arch, ctx);
}

async function fixCandidate(dir: string, cdir: string, arch: Architecture, ctx: FixContext, model?: string): Promise<Candidate> {
  const m = ctx.m ?? getMigration();
  // The round-robin's per-candidate fixer: the same architecture, this candidate's own model.
  const a = model ? { ...arch, fixerModel: model } : arch;
  await rmTree(cdir);
  copyRepo(dir, cdir);
  // Snapshot so the candidate's own diff can be measured, then undone before review.
  git(cdir, "add", "-A");
  git(cdir, "commit", "-q", "--no-verify", "-m", "shim: before fixer");

  let after = ctx.after;
  let remaining = ctx.findings;
  let review: Review | undefined;
  const unpriced = costUnpriced();
  let cost: number | null = unpriced ? null : 0;
  const agentRuns: string[] = [];
  const passing = () => !regressions(ctx.baseline, after).length && !remaining.length;
  const fix = async (reviewIssues?: string[]) => {
    const first = !agentRuns.length;
    const res = await runFixer(cdir, { findings: first ? ctx.findings : [], failures: ctx.failingOutput(after), reviewIssues, checks: ctx.checks, changeNotes: ctx.changeNotes }, a, m);
    agentRuns.push(res.text ?? res.output);
    if (!unpriced) cost = (cost ?? 0) + (res.cost ?? 0);
    // Reinstall only if the fixer touched a manifest; then drop the shared node_modules first.
    const manifests = git(cdir, "diff", "--name-only", "HEAD").output.split("\n").some((f) => MANIFESTS.test(f));
    if (manifests) await unshareNodeModules(cdir);
    after = ctx.gates(cdir, manifests);
    remaining = ctx.breaks(cdir);
  };

  for (let attempt = 1; attempt <= arch.attempts; attempt++) {
    await fix();
    if (passing()) break;
  }
  if (arch.review) {
    for (let round = 0; passing(); round++) {
      review = await runReviewer(cdir, arch.reviewerRules, arch.reviewerModel, m);
      if (!unpriced) cost = (cost ?? 0) + (review.cost ?? 0);
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

/**
 * Make the chosen candidate the repo, and drop the rest. Removes go through rmTree because the
 * original tree still carries the gates' node_modules (and candidate copies share hard links
 * into it): on Windows a lingering handle throws EBUSY on the first pass, which a plain
 * rmSync cannot get past.
 */
export async function adopt(dir: string, chosen: Candidate, all: Candidate[]): Promise<void> {
  await rmTree(dir);
  fs.renameSync(chosen.dir, dir);
  for (const c of all) if (c !== chosen) await rmTree(c.dir);
}
