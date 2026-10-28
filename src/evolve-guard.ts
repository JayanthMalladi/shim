/**
 * Guardrails for the evolve loop. Kept out of evolve.ts (which runs its main() at import) so the
 * decisions are unit-testable.
 */
import fs from "node:fs";
import path from "node:path";
import { run } from "./exec.js";


/** A row of the scored archive: enough to estimate what the next evaluation will cost. */
export interface ArchiveEntry {
  id: string;
  /** seed entries have no parent */
  parent?: string;
  cost: number;
}

/** Sum of every completed evaluation's cost. */
export function totalSpent(entries: ArchiveEntry[]): number {
  return entries.reduce((s, e) => s + e.cost, 0);
}

/**
 * Estimate the next evaluation's cost: the parent's cost when we have one, otherwise the most
 * expensive seed so far (0 when nothing has run yet, so the first seed always gets to establish
 * the cost model).
 */
export function estimateNext(entries: ArchiveEntry[], parent?: string): number {
  if (parent != null) {
    const p = entries.find((e) => e.id === parent);
    if (p) return p.cost;
  }
  const seedCosts = entries.filter((e) => e.parent == null).map((e) => e.cost);
  return seedCosts.length ? Math.max(...seedCosts) : 0;
}

/** True when spent-so-far plus the next estimate would go over budget. */
export function wouldExceedBudget({ spent, estimate, budgetUsd }: { spent: number; estimate: number; budgetUsd: number }): boolean {
  return spent + estimate > budgetUsd;
}

/**
 * The only models a genome's fixer or reviewer may use. Fable and Mythos are deliberately excluded:
 * they are more capable than the fixed judge, so a child could out-score its own judge by reaching
 * for a stronger model, which would corrupt the whole comparison. The mutator itself stays on
 * claude-opus-5-5.
 */
export const ALLOWED_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

/** Numeric bounds on the genome knobs: one bad mutation must not be able to spend the whole budget. */
export const GENOME_BOUNDS: Record<"candidates" | "attempts" | "fixerMaxTurns" | "reviewRounds", readonly [number, number]> = {
  candidates: [1, 4],
  attempts: [1, 3],
  fixerMaxTurns: [10, 60],
  reviewRounds: [0, 2],
};

/**
 * Round and clamp an unknown value into `[lo, hi]`. A value that does not parse (or is absent)
 * falls back to the default; a parseable number like 0 clamps to the range edge instead.
 */
export function bound(v: unknown, [lo, hi]: readonly [number, number], d: number): number {
  const n = Number(v ?? d);
  const value = Number.isNaN(n) ? d : Math.round(n);
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Replace any fixer/reviewer model off the allowlist with the default. This is how a child that
 * names a Fable or Mythos id (or any other unknown model) gets clamped back to a safe one. Returns
 * the fields that changed so the caller can note it in the child's record.
 */
export function sanitizeModels(a: { fixerModel?: string; reviewerModel?: string }, defaults: { fixerModel: string; reviewerModel: string }): { fixerModel: string; reviewerModel: string; clamped: string[] } {
  const clamped: string[] = [];
  const one = (v: string | undefined, d: string, field: string) => {
    if (v == null) return d;
    if (ALLOWED_MODELS.includes(v)) return v;
    clamped.push(field);
    return d;
  };
  return { fixerModel: one(a.fixerModel, defaults.fixerModel, "fixerModel"), reviewerModel: one(a.reviewerModel, defaults.reviewerModel, "reviewerModel"), clamped };
}

/**
 * Durable results: copy LOG.md and archive.jsonl from the run's out dir into the mirror, and if
 * the mirror is a git checkout, commit and push them so results survive the machine dying. A
 * push failure is returned as text, not thrown: the evolution must not crash on a dead remote.
 */
export function syncMirror(mirror: string, outDir: string, label: string): string {
  fs.mkdirSync(mirror, { recursive: true });
  for (const f of ["LOG.md", "archive.jsonl"])
    fs.copyFileSync(path.join(outDir, f), path.join(mirror, f));
  if (!run("git", ["rev-parse", "--is-inside-work-tree"], mirror).ok) return "copied (mirror is not a git checkout)";
  const git = (...args: string[]) => run("git", args, mirror);
  const cached = git("add", "LOG.md", "archive.jsonl");
  if (!cached.ok) return `copied; git add failed: ${cached.output.slice(-200)}`;
  if (git("diff", "--cached", "--quiet").code === 0) return "copied (no changes to commit)";
  const commit = run("git", ["-c", "user.name=shim-evolve", "-c", "user.email=shim-evolve@users.noreply.github.com", "commit", "-m", `evolve: results ${label}`], mirror);
  if (!commit.ok) return `copied; commit failed: ${commit.output.slice(-200)}`;
  const push = git("push", "origin", "HEAD");
  return push.ok ? "committed and pushed" : `committed locally; push failed: ${push.output.slice(-200)}`;
}


