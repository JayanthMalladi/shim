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
  /** When the evaluation finished (ISO timestamp; parsed for the in-flight cutoff). */
  at: string;
  /** Which bench set the evaluation ran on; runs/ is shared across sets. */
  set: string;
  /** Set when the run erred or hit rate limits; such runs don't count as evidence. */
  invalid?: string;
}

/** Sum of every completed evaluation's cost. */
export function totalSpent(entries: ArchiveEntry[]): number {
  return entries.reduce((s, e) => s + e.cost, 0);
}

/**
 * The in-flight part of the spend: completed result.json files that postdate the newest archived
 * evaluation of this architecture (the cutoff looks at every set, since runs/<id> is shared).
 * Result files older than that belong to runs the archive already counted, so a rerun of an
 * archived id (including --only on another set) is not double-counted; no archive entry means no
 * cutoff, so every result file counts.
 */
export function inFlightCost(
  entries: ArchiveEntry[],
  archId: string,
  resultFiles: { mtimeMs: number; cost: number; judgeCost?: number | null }[],
): number {
  const own = entries.filter((e) => e.id === archId).map((e) => Date.parse(e.at)).filter((t) => !Number.isNaN(t));
  const newest = own.length ? Math.max(...own) : undefined;
  return resultFiles
    .filter((f) => newest === undefined || f.mtimeMs > newest)
    .reduce((s, f) => s + f.cost + (f.judgeCost ?? 0), 0);
}

/**
 * Has the run already spent its budget? Checked before the mutator is called: once the spend
 * reaches the cap, another mutation would only make an evaluation the stop below won't start.
 */
export function shouldStopForBudget({ spent, budgetUsd }: { spent: number; budgetUsd?: number }): boolean {
  return budgetUsd !== undefined && spent >= budgetUsd;
}

/**
 * Estimate the next evaluation's cost: the parent's full evaluation cost when we have one that is
 * valid and from this set, otherwise the average evaluation cost of the set's non-invalid
 * entries, scaled to the number of repos the next evaluation runs (0 when nothing valid has run
 * in this set, so the first evaluation always gets to establish the cost model).
 */
export function estimateNext(entries: ArchiveEntry[], parent: string | undefined, set: string, repoCount: number): number {
  if (parent != null) {
    const p = entries.find((e) => e.id === parent);
    if (p && !p.invalid && p.set === set) return p.cost;
  }
  const eligible = entries.filter((e) => !e.invalid && e.set === set);
  if (!eligible.length) return 0;
  return (totalSpent(eligible) / eligible.length) * repoCount;
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
 *
 * Extensible via SHIM_EXTRA_MODELS (comma-separated). Any extra model id that contains "fable" or
 * "mythos" (case-insensitive) is dropped: the Fable/Mythos ban is absolute and cannot be overridden
 * by the environment.
 */
const DEFAULT_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
/** Fable and Mythos are banned absolutely: the env cannot override this. Exported for tests. */
export const FORBIDDEN_MODEL_RE = /fable|mythos/i;

function extraModels(): string[] {
  const raw = process.env.SHIM_EXTRA_MODELS ?? "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean).filter((m) => !FORBIDDEN_MODEL_RE.test(m));
}

export const ALLOWED_MODELS: string[] = [...DEFAULT_MODELS, ...extraModels()];

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
 * names a Fable or Mythos id (or any other unknown model) gets clamped back to a safe one. Fable
 * and Mythos ids are rejected explicitly (belt-and-braces), so the ban holds even if a Fable/Mythos
 * id were somehow added to ALLOWED_MODELS. Returns the fields that changed so the caller can note
 * it in the child's record.
 */
export function sanitizeModels(a: { fixerModel?: string; reviewerModel?: string }, defaults: { fixerModel: string; reviewerModel: string }): { fixerModel: string; reviewerModel: string; clamped: string[] } {
  const clamped: string[] = [];
  const one = (v: string | undefined, d: string, field: string) => {
    if (v == null) return d;
    if (FORBIDDEN_MODEL_RE.test(v)) { clamped.push(field); return d; }
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
  // Never commit or push to the main checkout: the mirror must be its own repo root and a
  // dedicated branch, or we would land every evaluation on main (or the remote's default).
  // Compare the reported root with the mirror dir case- and separator-insensitively: on
  // Windows git prints forward slashes and drive letters may differ in case.
  const norm = (p: string) => p.toLowerCase().split(/[\\/]/).filter(Boolean).join("/");
  const toplevel = git("rev-parse", "--show-toplevel").output.trim();
  if (norm(toplevel) !== norm(mirror))
    return `copied (mirror is inside a bigger repo: ${toplevel}); not committing or pushing`;
  const branch = git("rev-parse", "--abbrev-ref", "HEAD").output.trim();
  if (branch === "main" || branch === "master")
    return `copied (mirror is on ${branch}); not committing or pushing`;
  const remoteDefault = git("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD").output.trim();
  if (remoteDefault && remoteDefault.split("/")[1] === branch)
    return `copied (mirror is on ${branch}, the remote's default); not committing or pushing`;
  const cached = git("add", "LOG.md", "archive.jsonl");
  if (!cached.ok) return `copied; git add failed: ${cached.output.slice(-200)}`;
  if (git("diff", "--cached", "--quiet").code === 0) return "copied (no changes to commit)";
  const commit = run("git", ["-c", "user.name=shim-evolve", "-c", "user.email=shim-evolve@users.noreply.github.com", "commit", "-m", `evolve: results ${label}`], mirror);
  if (!commit.ok) return `copied; commit failed: ${commit.output.slice(-200)}`;
  const push = git("push", "origin", "HEAD");
  return push.ok ? "committed and pushed" : `committed locally; push failed: ${push.output.slice(-200)}`;
}

