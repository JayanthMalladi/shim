import { describe, expect, it } from "vitest";
import { fixerPrompt, reviewerPrompt, JUDGE_RULES } from "../src/agent.js";
import { DEFAULT_ARCH, REVIEWER_RULES } from "../src/arch.js";
import { prBody } from "../src/pr-body.js";
import { AI_SDK_V7, ZOD_V4, getMigration } from "../src/migrations.js";
import type { MigrationReport } from "../src/pipeline.js";
import type { Finding } from "../src/types.js";

/** A fixed brief and report, so the golden files are stable across runs. */
const finding: Finding = { ruleId: "multi-step-result", severity: "silent", fix: "agent", file: "src/a.ts", line: 3, snippet: "r.usage", message: "m" };
const brief = { findings: [finding], failures: "x", reviewIssues: ["y"] };
const report: MigrationReport = {
  repo: "o/r", verdict: "open-pr", reason: "", versionChanges: ["ai: ^6.0.0 -> ^7.0.0"], library: false, codemod: true,
  autoFixed: 0, before: [finding], remaining: [], baseline: { install: true, "typecheck .": true }, after: { install: true, "typecheck .": true },
  regressions: [], failures: {}, agentRuns: [], candidates: [], diffStat: "", changedFiles: ["package.json"], repairedChecks: [],
};

describe("golden prompts (safety net: these must stay byte-identical to main)", () => {
  it("fixerPrompt with DEFAULT_ARCH", async () => {
    await expect(fixerPrompt(brief, DEFAULT_ARCH, AI_SDK_V7)).toMatchFileSnapshot("./__golden__/fixer-default.txt");
  });
  it("fixerPrompt with audit", async () => {
    await expect(fixerPrompt(brief, { ...DEFAULT_ARCH, audit: true }, AI_SDK_V7)).toMatchFileSnapshot("./__golden__/fixer-audit.txt");
  });
  it("reviewerPrompt with the reviewer rules", async () => {
    await expect(reviewerPrompt(REVIEWER_RULES)).toMatchFileSnapshot("./__golden__/reviewer-rules.txt");
  });
  it("reviewerPrompt with the judge rules", async () => {
    await expect(reviewerPrompt(JUDGE_RULES)).toMatchFileSnapshot("./__golden__/reviewer-judge.txt");
  });
  it("prBody for the report in pr-body.test.ts's first case", async () => {
    await expect(prBody(report)).toMatchFileSnapshot("./__golden__/pr-body.txt");
  });
});

describe("getMigration default", () => {
  it("getMigration(undefined) is the AI SDK migration (old prepared.json compatibility)", () => {
    expect(getMigration(undefined)).toBe(AI_SDK_V7);
    expect(getMigration("ai-sdk-v7")).toBe(AI_SDK_V7);
  });
});

describe("Zod reviewer and judge prompt", () => {
  // T15 Part C: the judge spent both 50-turn runs on denied tsc/npm calls and never gave a verdict.
  it("says which tools work and that the gates already ran", () => {
    const p = reviewerPrompt(ZOD_V4.judgeRules, ZOD_V4);
    expect(p).toContain("only `git diff` and `git status`");
    expect(p).toContain("do not try to run them");
  });
  // T14: the judge rejected log-10x's z.partialRecord and .prefault fixes, both checked on zod 3.25.76 and 4.6.7.
  it("names the behavior-preserving record and object-default fixes", () => {
    const p = reviewerPrompt(ZOD_V4.judgeRules, ZOD_V4);
    expect(p).toContain("`z.partialRecord()` keeps Zod 3 behavior");
    expect(p).toContain("`.prefault()` keeps Zod 3 behavior");
    expect(p).not.toContain("takes string keys only");
  });
});
