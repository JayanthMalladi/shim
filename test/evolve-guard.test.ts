import { describe, expect, it } from "vitest";
import { totalSpent, estimateNext, wouldExceedBudget, type ArchiveEntry } from "../src/evolve-guard.js";

const SEEDS: ArchiveEntry[] = [
  { id: "v1", cost: 20 },
  { id: "v2", cost: 55 },
];
const CHILD: ArchiveEntry = { id: "g1-v2-ab12", parent: "v2", cost: 40 };

describe("totalSpent", () => {
  it("sums every completed evaluation's cost", () => {
    expect(totalSpent(SEEDS)).toBe(75);
    expect(totalSpent([...SEEDS, CHILD])).toBe(115);
    expect(totalSpent([])).toBe(0);
  });
});

describe("estimateNext", () => {
  it("estimates a child by its parent's cost", () => {
    expect(estimateNext([...SEEDS, CHILD], "v2")).toBe(55);
  });
  it("estimates a seed by the most expensive seed so far", () => {
    expect(estimateNext(SEEDS)).toBe(55);
    expect(estimateNext([SEEDS[0]!])).toBe(20);
  });
  it("returns 0 when nothing has run, so the first seed always starts", () => {
    expect(estimateNext([])).toBe(0);
  });
  it("falls back to the seed estimate when the parent is unknown", () => {
    expect(estimateNext([...SEEDS, CHILD], "never-seen")).toBe(55);
  });
});

describe("wouldExceedBudget", () => {
  it("stops when spent plus the estimate passes the budget", () => {
    expect(wouldExceedBudget({ spent: 100, estimate: 55, budgetUsd: 150 })).toBe(true);
    expect(wouldExceedBudget({ spent: 100, estimate: 55, budgetUsd: 155 })).toBe(false);
  });
  it("a fresh run with no spend fits any budget", () => {
    expect(wouldExceedBudget({ spent: 0, estimate: 0, budgetUsd: 1 })).toBe(false);
  });
});
