import { describe, expect, it } from "vitest";
import { totalSpent, estimateNext, wouldExceedBudget, sanitizeModels, ALLOWED_MODELS, type ArchiveEntry } from "../src/evolve-guard.js";

const D = { fixerModel: "claude-opus-5-5", reviewerModel: "claude-opus-5-5" };

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

describe("sanitizeModels", () => {
  it("lets allowlisted models through untouched", () => {
    for (const m of ALLOWED_MODELS) {
      const out = sanitizeModels({ fixerModel: m, reviewerModel: m }, D);
      expect(out).toEqual({ fixerModel: m, reviewerModel: m, clamped: [] });
    }
  });
  it("clamps Fable or Mythos ids back to the default and records which fields", () => {
    const out = sanitizeModels({ fixerModel: "claude-fable-5-1", reviewerModel: "claude-mythos-5-1" }, D);
    expect(out).toEqual({ fixerModel: D.fixerModel, reviewerModel: D.reviewerModel, clamped: ["fixerModel", "reviewerModel"] });
  });
  it("falls back to the default when a model is absent, without flagging it", () => {
    expect(sanitizeModels({}, D)).toEqual({ fixerModel: D.fixerModel, reviewerModel: D.reviewerModel, clamped: [] });
  });
  it("clamps a single offending field and leaves the other alone", () => {
    const out = sanitizeModels({ fixerModel: "claude-gpt-9", reviewerModel: "claude-haiku-5-5" }, D);
    expect(out).toEqual({ fixerModel: D.fixerModel, reviewerModel: "claude-haiku-5-5", clamped: ["fixerModel"] });
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
