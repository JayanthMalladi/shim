import { describe, expect, it } from "vitest";
import type { MigrationReport } from "../src/pipeline.js";
import { prBody } from "../src/pr-body.js";
import type { Finding } from "../src/types.js";

const report = (over: Partial<MigrationReport> = {}): MigrationReport => ({
  repo: "o/r", verdict: "open-pr", reason: "", versionChanges: ["ai: ^6.0.0 -> ^7.0.0"], library: false, codemod: true,
  autoFixed: 0, before: [], remaining: [], baseline: { install: true, "typecheck .": true }, after: { install: true, "typecheck .": true },
  regressions: [], failures: {}, agentRuns: [], candidates: [], diffStat: "", changedFiles: ["package.json"], repairedChecks: [],
  ...over,
});
const finding = (over: Partial<Finding>): Finding => ({
  ruleId: "multi-step-result", severity: "silent", fix: "auto", file: "src/a.ts", line: 10, snippet: "result.usage",
  message: "`result.usage` now covers every step.", ...over,
});
/** A -U0 diff that rewrites the given old-side line of src/a.ts. */
const rewrite = (line: number) => `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -${line} +${line} @@\n-  bill(result.usage);\n+  bill(result.finalStep.usage);\n`;

describe("prBody", () => {
  it("says no code changed on a deps-only PR and skips the finalStep example", () => {
    const body = prBody(report());
    expect(body).toContain("No code changes needed");
    expect(body).not.toContain("finalStep");
    expect(body).not.toContain("codemod's renames covered");
  });

  it("names the files the codemod changed when Shim fixed nothing", () => {
    const body = prBody(report({ changedFiles: ["package.json", "src/a.ts", "src/b.ts"] }));
    expect(body).toContain("Source files changed (codemod renames): `src/a.ts`, `src/b.ts`.");
    expect(body).not.toContain("No code changes");
  });

  it("explains finalStep only when a multi-step read was fixed", () => {
    const systemOnly = finding({ ruleId: "system-in-messages", severity: "break", message: "needs the option" });
    expect(prBody(report({ before: [systemOnly], changedFiles: ["src/a.ts"] }))).not.toContain("finalStep");
    expect(prBody(report({ before: [finding({})], changedFiles: ["src/a.ts"] }))).toContain("this PR reads the same value from `finalStep`");
  });

  it("groups identical messages into one bullet with every location", () => {
    const body = prBody(report({
      before: [finding({ line: 3 }), finding({ line: 8 }), finding({ file: "src/b.ts", line: 4 }), finding({ line: 9, message: "other" })],
      changedFiles: ["src/a.ts", "src/b.ts"],
    }));
    expect(body).toContain("- `src/a.ts:3`, `src/a.ts:8`, `src/b.ts:4`: `result.usage` now covers every step.");
    expect(body.match(/now covers every step/g)).toHaveLength(1);
    expect(body).toContain("`src/a.ts:9`: other");
  });

  it("labels a package that appears more than once and collapses exact duplicates", () => {
    const body = prBody(report({
      versionChanges: [
        "ai (packages/a/package.json, devDependencies): ^6.0.0 -> ^7.0.0",
        "ai (packages/a/package.json, peerDependencies): ^5.0.0 || ^6.0.0 -> ^7.0.0",
        "ai (packages/b/package.json, peerDependencies): ^5.0.0 || ^6.0.0 -> ^7.0.0",
        "@ai-sdk/openai: ^3.0.0 -> ^4.0.0",
        "@ai-sdk/openai: ^3.0.0 -> ^4.0.0",
      ],
    }));
    expect(body).toContain("- `ai` (packages/a/package.json, devDependencies): ^6.0.0 → ^7.0.0");
    expect(body).toContain("- `ai` (packages/a/package.json, peerDependencies): ^5.0.0 || ^6.0.0 → ^7.0.0");
    expect(body).toContain("- `ai` (packages/b/package.json, peerDependencies): ^5.0.0 || ^6.0.0 → ^7.0.0");
    expect(body.match(/@ai-sdk\/openai/g)).toHaveLength(1);
  });

  it("finds the field of a bump in the diff when the report doesn't say", () => {
    const patch = [
      "diff --git a/package.json b/package.json", "--- a/package.json", "+++ b/package.json", "@@ -40,4 +40,4 @@",
      '   "peerDependencies": {', '-    "ai": "^5.0.0 || ^6.0.0",', '+    "ai": "^7.0.0",', '     "zod": "^4.0.0"',
      "@@ -32,3 +32,3 @@", '     "@types/node": "^20.0.0",', '-    "ai": "^6.0.0",', '+    "ai": "^7.0.0",', "",
    ].join("\n");
    const body = prBody(report({ versionChanges: ["ai: ^6.0.0 -> ^7.0.0", "ai: ^5.0.0 || ^6.0.0 -> ^7.0.0"] }), patch);
    expect(body).toContain("- `ai` (peerDependencies): ^5.0.0 || ^6.0.0 → ^7.0.0");
  });

  it("does not claim a finding the patch left alone as fixed", () => {
    const kept = finding({ line: 40, snippet: "result.warnings", message: "`result.warnings` now covers every step." });
    const body = prBody(report({ before: [finding({ line: 10 }), kept], changedFiles: ["src/a.ts"] }), rewrite(10));
    const [fixed, eyes] = body.split("### Needs your eyes");
    expect(fixed).toContain("`src/a.ts:10`");
    expect(fixed).not.toContain("src/a.ts:40");
    expect(eyes).toContain("`src/a.ts:40`: `result.warnings` now covers every step.");
    expect(body).toContain('except where noted under "Needs your eyes"');
  });

  it("counts an allowSystemInMessages insertion in the same call as the fix", () => {
    const sys = finding({ ruleId: "system-in-messages", severity: "break", line: 20, message: "sys" });
    const insert = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -24,0 +25 @@\n+    allowSystemInMessages: true,\n";
    expect(prBody(report({ before: [sys], changedFiles: ["src/a.ts"] }), insert)).toContain("**Fixed: would fail at runtime on v7**");
    // The same line added far from the finding belongs to some other call.
    const far = insert.replace("@@ -24,0 +25 @@", "@@ -90,0 +91 @@");
    expect(prBody(report({ before: [sys], changedFiles: ["src/a.ts"] }), far)).not.toContain("**Fixed");
  });

  it("omits unfixed deprecated findings, keeps the layout tight, and keeps the footer", () => {
    const body = prBody(report({ before: [finding({ ruleId: "total-usage", severity: "deprecated", message: "totalUsage is deprecated" })], changedFiles: ["src/a.ts"] }), rewrite(99));
    expect(body).not.toContain("Needs your eyes");
    expect(body).not.toMatch(/\n\n\n/);
    expect(body).toContain("| install | pass | pass |");
    expect(body).toContain("### Rollback");
    expect(body).toContain("Opened by [Shim]");
  });
});
