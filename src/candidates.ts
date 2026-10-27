import fs from "node:fs";
import { runFixer } from "./agent.js";
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
  ok: boolean;
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
}

const LOCKFILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/;
const git = (dir: string, ...args: string[]) =>
  run("git", ["-c", "user.name=shim", "-c", "user.email=shim@localhost", ...args], dir);

/**
 * The fixer is not deterministic, so run several independent fixers on copies of the repo and let the
 * gates choose. Agents run side by side; gates run one at a time (they are sync), which keeps memory sane.
 */
export async function fixInParallel(dir: string, n: number, attempts: number, ctx: FixContext): Promise<Candidate[]> {
  return Promise.all(
    Array.from({ length: n }, async (_, i): Promise<Candidate> => {
      const cdir = `${dir}.cand${i}`;
      fs.rmSync(cdir, { recursive: true, force: true });
      run("cp", ["-a", dir, cdir], ".");
      // Snapshot so the candidate's own diff can be measured, then undone before review.
      git(cdir, "add", "-A");
      git(cdir, "commit", "-q", "--no-verify", "-m", "shim: before fixer");

      let after = ctx.after;
      let remaining = ctx.findings;
      const agentRuns: string[] = [];
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const res = await runFixer(cdir, attempt === 1 ? ctx.findings : [], ctx.failingOutput(after));
        agentRuns.push(res.output);
        after = ctx.gates(cdir);
        remaining = ctx.breaks(cdir);
        if (!regressions(ctx.baseline, after).length && !remaining.length) break;
      }

      git(cdir, "add", "-A");
      const size = git(cdir, "diff", "--cached", "--numstat", "HEAD").output.split("\n")
        .map((l) => l.split("\t"))
        .filter(([, , file]) => file && !LOCKFILES.test(file))
        .reduce((sum, [a, d]) => sum + (Number(a) || 0) + (Number(d) || 0), 0);
      git(cdir, "reset", "-q", "--soft", "HEAD~1");
      git(cdir, "reset", "-q");
      const ok = !regressions(ctx.baseline, after).length && !remaining.length;
      return { dir: cdir, after, remaining, agentRuns, size, ok };
    }),
  );
}

/** Passing candidates first, smallest diff first; then the least-broken failures. */
export function rank(cands: Candidate[], baseline: GateResults): Candidate[] {
  const score = (c: Candidate) => [c.ok ? 0 : 1, regressions(baseline, c.after).length, c.remaining.length, c.size];
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
