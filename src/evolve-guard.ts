/**
 * Guardrails for the evolve loop. Kept out of evolve.ts (which runs its main() at import) so the
 * decisions are unit-testable.
 */

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


