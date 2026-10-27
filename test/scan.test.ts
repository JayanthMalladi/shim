import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scan, scanAndFix } from "../src/scan.js";

const fixture = path.join(import.meta.dirname, "fixtures/v6-app");

function copyFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-"));
  fs.cpSync(fixture, dir, { recursive: true });
  return dir;
}

describe("ai-sdk v7 scan", () => {
  const { result } = scan(fixture);
  const at = (rule: string) =>
    result.findings.filter((f) => f.ruleId === rule).map((f) => `${f.file}:${f.line}`);

  it("flags multi-step result reads but not single-step ones", () => {
    expect(at("multi-step-result")).toEqual([
      "src/agent.ts:17",
      "src/agent.ts:18",
      "src/agent.ts:31",
      "src/agent.ts:45",
    ]);
  });

  it("flags end-callback reads, response.messages and totalUsage", () => {
    expect(at("multi-step-end-event")).toEqual(["src/agent.ts:14"]);
    expect(at("response-messages")).toEqual(["src/agent.ts:19"]);
    expect(at("total-usage")).toEqual(["src/agent.ts:20"]);
  });

  it("flags runtime breaks: system messages, require, node engine", () => {
    expect(at("system-in-messages")).toEqual(["src/agent.ts:41"]);
    expect(at("esm-only")).toEqual(["src/legacy.cjs:1"]);
    expect(at("node-22")).toEqual(["package.json:1"]);
  });

  it("flags telemetry without registerTelemetry", () => {
    expect(at("telemetry-needs-otel")).toEqual(["src/agent.ts:39"]);
  });
});

describe("auto fixes", () => {
  it("rewrites generateText reads to keep v6 behavior", async () => {
    const dir = copyFixture();
    const { applied } = await scanAndFix(dir);
    const src = fs.readFileSync(path.join(dir, "src/agent.ts"), "utf8");
    expect(applied).toBe(5);
    expect(src).toContain("bill(event.finalStep.usage.totalTokens)");
    expect(src).toContain("bill(result.finalStep.usage.totalTokens)");
    expect(src).toContain("const calls = result.finalStep.toolCalls");
    expect(src).toContain("const history = result.responseMessages");
    expect(src).toContain("const total = result.usage");
    // Single-step call untouched.
    expect(src).toContain("return result.usage;\n}");
  });
});
