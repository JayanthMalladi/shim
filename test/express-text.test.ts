import { describe, expect, it } from "vitest";
import { fixerPrompt, reviewerPrompt } from "../src/agent.js";
import { DEFAULT_ARCH } from "../src/arch.js";
import { EXPRESS_V5 } from "../src/migrations.js";
import type { MigrationReport } from "../src/pipeline.js";
import { prBody } from "../src/pr-body.js";
import type { Finding } from "../src/types.js";

/** Words the Express prompts must never leak (the AI SDK or the Zod migration). */
const FOREIGN_WORDS = /AI SDK|finalStep|generateText|\bv7\b|zod|Zod 4|\.default\(\)|\.prefault/;

const finding: Finding = {
  ruleId: "express-splat-param", severity: "break", fix: "auto", file: "src/app.ts", line: 10,
  snippet: "'*'", message: "This wildcard route REG-THROWS in Express 5; rewrote it to a named splat.",
};
const report = (over: Partial<MigrationReport> = {}): MigrationReport => ({
  repo: "o/r", verdict: "open-pr", reason: "", versionChanges: ["express (package.json, dependencies): ^4.21.0 -> ^5.0.0"], library: false, codemod: true,
  autoFixed: 1, before: [finding], remaining: [], baseline: { install: true, "test .": true }, after: { install: true, "test .": true },
  regressions: [], failures: {}, agentRuns: [], candidates: [], diffStat: "", changedFiles: ["package.json", "src/app.ts"], repairedChecks: [],
  ...over,
});

describe("Express agent text", () => {
  // finish() swaps the Express rules into the architecture and turns the AI SDK audit off.
  const arch = { ...DEFAULT_ARCH, fixerRules: EXPRESS_V5.fixerRules, reviewerRules: EXPRESS_V5.reviewerRules, audit: false };

  it("the fixer prompt is all Express, no AI SDK or Zod words", () => {
    const p = fixerPrompt({ findings: [finding] }, arch, EXPRESS_V5);
    expect(p.startsWith(EXPRESS_V5.fixerIntro)).toBe(true);
    expect(p).toContain(EXPRESS_V5.fixerRules);
    expect(p).toContain(`Reference: ${EXPRESS_V5.reference}`);
    expect(p).not.toMatch(FOREIGN_WORDS);
  });

  it("the reviewer and judge prompts are all Express, and the judge is stricter", () => {
    expect(reviewerPrompt(EXPRESS_V5.reviewerRules, EXPRESS_V5)).not.toMatch(FOREIGN_WORDS);
    expect(reviewerPrompt(EXPRESS_V5.judgeRules, EXPRESS_V5)).not.toMatch(FOREIGN_WORDS);
    // The judge's rules strictly extend the reviewer's, mirroring the Zod one.
    expect(EXPRESS_V5.judgeRules.startsWith(EXPRESS_V5.reviewerRules)).toBe(true);
    expect(EXPRESS_V5.judgeRules.length).toBeGreaterThan(EXPRESS_V5.reviewerRules.length);
  });

  it("the judge prompt names the tools the reviewer can use", () => {
    const p = reviewerPrompt(EXPRESS_V5.judgeRules, EXPRESS_V5);
    expect(p).toContain("only `git diff` and `git status`");
    expect(p).toContain("do not try to run them");
  });

  it("the changeset text names Express 5", () => {
    expect(EXPRESS_V5.changesetText).toBe("Upgrade to Express 5. Requires Node.js 18 or later.");
  });
});

describe("Express PR body", () => {
  it("names Express 5 everywhere and never AI SDK or Zod", () => {
    const body = prBody(report(), undefined, EXPRESS_V5);
    expect(body.startsWith("## Upgrade to Express 5\n\nThis PR moves the project from Express 4 to 5 and keeps its current behavior.")).toBe(true);
    expect(body).toContain("**Fixed: would fail at startup on Express 5**");
    expect(body).toContain("Also ran `npx @expressjs/codemod` (official codemod). Install ran with `--ignore-scripts`.");
    expect(body).not.toMatch(FOREIGN_WORDS);
  });

  it("adds the library line only for libraries", () => {
    const line = "This drops support for Express 4, so users of this package will need Express 5 too. It probably belongs in a new major version.";
    expect(prBody(report({ library: true }), undefined, EXPRESS_V5)).toContain(line);
    expect(prBody(report(), undefined, EXPRESS_V5)).not.toContain(line);
  });

  it("doesn't claim the codemod ran when it didn't", () => {
    const body = prBody(report({ codemod: false }), undefined, EXPRESS_V5);
    expect(body).not.toContain("@expressjs/codemod");
    expect(body).toContain("Install ran with `--ignore-scripts`.");
  });
});
