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

