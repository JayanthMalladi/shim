import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fixerPrompt, reviewerPrompt } from "../src/agent.js";
import { DEFAULT_ARCH } from "../src/arch.js";
import { ZOD_V4 } from "../src/migrations.js";
import type { MigrationReport } from "../src/pipeline.js";
import { prBody } from "../src/pr-body.js";
import { recordedMigration } from "../src/pr.js";
import type { Finding } from "../src/types.js";

const AI_SDK_WORDS = /AI SDK|finalStep|generateText|\bv7\b|\(T4\)|T4:/;

const finding: Finding = {
  ruleId: "zod-uuid-strict", severity: "silent", fix: "auto", file: "src/a.ts", line: 3,
  snippet: "z.string().uuid()", message: "Zod 4's .uuid() rejects non-RFC UUIDs; .guid() keeps the Zod 3 check.",
};
const report = (over: Partial<MigrationReport> = {}): MigrationReport => ({
  repo: "o/r", verdict: "open-pr", reason: "", versionChanges: ["zod (package.json, dependencies): ^3.25.0 -> ^4.0.0"], library: false, codemod: true,
  autoFixed: 1, before: [finding], remaining: [], baseline: { install: true, "test .": true }, after: { install: true, "test .": true },
  regressions: [], failures: {}, agentRuns: [], candidates: [], diffStat: "", changedFiles: ["package.json", "src/a.ts"], repairedChecks: [],
  ...over,
});

describe("Zod agent text", () => {
  // finish() swaps the Zod rules into the architecture and turns the AI SDK audit off.
  const arch = { ...DEFAULT_ARCH, fixerRules: ZOD_V4.fixerRules, reviewerRules: ZOD_V4.reviewerRules, audit: false };

  it("the fixer prompt is all Zod", () => {
    const p = fixerPrompt({ findings: [finding] }, arch, ZOD_V4);
    expect(p.startsWith(ZOD_V4.fixerIntro)).toBe(true);
    expect(p).toContain(ZOD_V4.fixerRules);
    expect(p).toContain(`Reference: ${ZOD_V4.reference}`);
    expect(p).not.toMatch(AI_SDK_WORDS);
  });

  it("the reviewer and judge prompts are all Zod, and the judge is stricter", () => {
    expect(reviewerPrompt(ZOD_V4.reviewerRules, ZOD_V4)).not.toMatch(AI_SDK_WORDS);
    expect(reviewerPrompt(ZOD_V4.judgeRules, ZOD_V4)).not.toMatch(AI_SDK_WORDS);
    expect(ZOD_V4.judgeRules.startsWith(ZOD_V4.reviewerRules)).toBe(true);
    expect(ZOD_V4.judgeRules.length).toBeGreaterThan(ZOD_V4.reviewerRules.length);
  });

  it("the changeset text names zod 4", () => {
    expect(ZOD_V4.changesetText).toBe("Upgrade to Zod 4. Requires zod@4.");
  });
});

describe("Zod PR body", () => {
  it("names Zod 4 everywhere and never AI SDK", () => {
    const body = prBody(report(), undefined, ZOD_V4);
    expect(body.startsWith("## Upgrade to Zod 4\n\nThis PR moves the project from Zod 3 to 4 and keeps its current behavior.")).toBe(true);
    expect(body).toContain("**Fixed: same code, different behavior on Zod 4**");
    expect(body).toContain("Also ran `npx zod-v3-to-v4` (community codemod). Install ran with `--ignore-scripts`.");
    expect(body).not.toMatch(AI_SDK_WORDS);
  });

  it("adds the library line only for libraries", () => {
    const line = "If this package's public types include Zod schemas, users will see Zod 4 types. That probably belongs in a new major version.";
    expect(prBody(report({ library: true }), undefined, ZOD_V4)).toContain(line);
    expect(prBody(report(), undefined, ZOD_V4)).not.toContain(line);
  });

  it("doesn't claim the codemod ran when it didn't", () => {
    const body = prBody(report({ codemod: false }), undefined, ZOD_V4);
    expect(body).not.toContain("zod-v3-to-v4");
    expect(body).toContain("Install ran with `--ignore-scripts`.");
  });
});

describe("recordedMigration", () => {
  it("reads the migration line from status.txt", () => {
    expect(recordedMigration("needs-review\nreason\nmigration: zod-v4\nHEAD: abc1234\n")).toBe("zod-v4");
  });
  it("falls back to prepared.json in the draft folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-"));
    fs.writeFileSync(path.join(dir, "prepared.json"), JSON.stringify({ prepared: { migration: "zod-v4" } }));
    expect(recordedMigration("ready\nHEAD: abc1234\n", dir)).toBe("zod-v4");
  });
  it("defaults to AI SDK for old drafts", () => {
    expect(recordedMigration("ready\nHEAD: abc1234\n")).toBe("ai-sdk-v7");
    expect(recordedMigration(undefined, fs.mkdtempSync(path.join(os.tmpdir(), "draft-")))).toBe("ai-sdk-v7");
  });
});
