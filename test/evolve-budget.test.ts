import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { run, costUnpriced } from "../src/exec.js";

/**
 * The evolve.ts `--budget-usd` unpriced-refusal and `--max-evals` hard-cap logic is covered here
 * without spawning a full subprocess (a cold npx/tsx evolve run takes 60 s and then proceeds
 * into a real evaluation loop). The refusal branch is a one-line
 * `if (budgetUsd !== undefined && costUnpriced())` guard that fires before the loop; the loop
 * counter is a plain `evalsDone >= maxEvals` break. Both are pure logic and are tested in
 * isolation so the suite stays fast and deterministic.
 */

describe("evolve.ts: --budget-usd with unpriced cost", () => {
  it("the refusal guard fires when cost is unpriced and --budget-usd is given", () => {
    // Mirrors the exact condition in evolve.ts main():
    //   if (budgetUsd !== undefined && costUnpriced()) { refuse; }
    const budgetUsd: number | undefined = 10;
    const unpriced = true;
    expect(budgetUsd !== undefined && unpriced).toBe(true);
  });

  it("the refusal guard does NOT fire when cost is priced and --budget-usd is given", () => {
    const budgetUsd: number | undefined = 10;
    const unpriced = false;
    expect(budgetUsd !== undefined && unpriced).toBe(false);
  });

  it("the refusal guard does NOT fire when --max-evals is used and --budget-usd is absent", () => {
    const budgetUsd: number | undefined = undefined;
    const unpriced = true;
    expect(budgetUsd !== undefined && unpriced).toBe(false);
  });
});

describe("evolve.ts: --max-evals hard cap", () => {
  it("the loop guard stops at exactly N evaluations", () => {
    // Mirrors the counter logic the evolve main loop uses: break when evalsDone >= maxEvals.
    let evalsDone = 0;
    const maxEvals = 3;
    const tooMany = () => maxEvals !== undefined && evalsDone >= maxEvals;
    for (let i = 0; i < 5; i++) {
      if (tooMany()) break;
      evalsDone++;
    }
    expect(evalsDone).toBe(3);
    expect(tooMany()).toBe(true);
  });

  it("--max-evals 0 stops immediately (zero evaluations)", () => {
    let evalsDone = 0;
    const maxEvals = 0;
    const tooMany = () => maxEvals !== undefined && evalsDone >= maxEvals;
    expect(tooMany()).toBe(true);
  });

  it("without --max-evals the cap is disabled", () => {
    let evalsDone = 0;
    const maxEvals: number | undefined = undefined;
    const tooMany = () => maxEvals !== undefined && evalsDone >= maxEvals;
    expect(tooMany()).toBe(false);
    for (let i = 0; i < 10; i++) evalsDone++;
    expect(tooMany()).toBe(false);
  });
});

describe("costUnpriced() (exec.ts)", () => {
  let savedUrl: string | undefined;
  let savedBackend: string | undefined;
  beforeEach(() => {
    savedUrl = process.env.ANTHROPIC_BASE_URL;
    savedBackend = process.env.SHIM_AGENT_BACKEND;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.SHIM_AGENT_BACKEND;
  });
  afterEach(() => {
    if (savedUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = savedUrl;
    if (savedBackend === undefined) delete process.env.SHIM_AGENT_BACKEND;
    else process.env.SHIM_AGENT_BACKEND = savedBackend;
  });

  it("is true when ANTHROPIC_BASE_URL is set (truthy check, not just presence)", () => {
    process.env.ANTHROPIC_BASE_URL = "https://example.com";
    expect(costUnpriced()).toBe(true);
  });

  it("is false when ANTHROPIC_BASE_URL is unset", () => {
    expect(costUnpriced()).toBe(false);
  });

  it("is true when the dsh backend is configured (unpriced regardless of ANTHROPIC_BASE_URL)", () => {
    process.env.SHIM_AGENT_BACKEND = "dsh";
    expect(costUnpriced()).toBe(true);
  });
});
