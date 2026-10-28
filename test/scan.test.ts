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

  it("sends reads on calls with hidden options to the agent, without a rewrite", () => {
    expect(at("maybe-multi-step-result")).toEqual(["src/agent.ts:51"]);
    expect(result.findings.find((f) => f.ruleId === "maybe-multi-step-result")?.fix).toBe("agent");
  });

  it("flags end-callback reads, response.messages and totalUsage", () => {
    expect(at("multi-step-end-event")).toEqual(["src/agent.ts:14"]);
    expect(at("response-messages")).toEqual(["src/agent.ts:19"]);
    expect(at("total-usage")).toEqual(["src/agent.ts:20"]);
  });

  it("flags runtime breaks: system messages, require, node engine", () => {
    expect(at("system-in-messages")).toContain("src/agent.ts:41");
    expect(at("esm-only")).toEqual(["src/legacy.cjs:1"]);
    expect(at("node-22")).toEqual(["package.json:1"]);
  });

  it("flags messages that may hold a system message, but not provably system-free ones", () => {
    expect(at("system-in-messages")).toEqual([
      "src/agent.ts:41", // literal system message
      "src/messages.ts:11", // messages: history
      "src/messages.ts:17", // messages: buildMessages(q)
      "src/messages.ts:22", // literal array with a sys() helper element
      "src/messages.ts:26", // generateObject
      "src/messages.ts:46", // agent whose .generate() takes variable messages
      "src/messages.ts:55", // exported agent: calls not visible
    ]);
    expect(result.findings.filter((f) => f.ruleId === "system-in-messages").every((f) => f.fix === "auto")).toBe(true);
    // Not flagged: user/assistant literals, string prompts, allowSystemInMessages already set, string-only agent.
    expect(at("system-in-messages")).not.toContain("src/messages.ts:32");
  });

  it("sends system-message checks on opaque options to the agent", () => {
    expect(at("maybe-system-in-messages")).toEqual(["src/agent.ts:50", "src/messages.ts:42"]);
    expect(result.findings.find((f) => f.ruleId === "maybe-system-in-messages")?.fix).toBe("agent");
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
    expect(applied).toBe(5 + 7);
    expect(src).toContain("bill(event.finalStep.usage.totalTokens)");
    expect(src).toContain("bill(result.finalStep.usage.totalTokens)");
    expect(src).toContain("const calls = result.finalStep.toolCalls");
    expect(src).toContain("const history = result.responseMessages");
    expect(src).toContain("const total = result.usage");
    // Single-step call untouched.
    expect(src).toContain("return result.usage;\n}");
    // Hidden options and the repo's own totalUsage field untouched.
    expect(src).toContain("return result.toolCalls;\n}\n\ndeclare const billing");
    expect(src).toContain("return billing.totalUsage;");
  });

  it("sets allowSystemInMessages where a system message can't be ruled out", async () => {
    const dir = copyFixture();
    await scanAndFix(dir);
    const agent = fs.readFileSync(path.join(dir, "src/agent.ts"), "utf8");
    expect(agent).toContain("      { role: 'user', content: 'Hello' },\n    ],\n    allowSystemInMessages: true,\n  });");
    const src = fs.readFileSync(path.join(dir, "src/messages.ts"), "utf8");
    expect(src).toContain("generateText({ model, messages: history, allowSystemInMessages: true });");
    expect(src).toContain("messages: buildMessages(q),\n    allowSystemInMessages: true,\n  });");
    expect(src).toContain("{ role: 'user', content: q }], allowSystemInMessages: true });");
    expect(src).toContain("messages: history, temperature: 0, allowSystemInMessages: true });");
    expect(src).toContain("const tracked = new ToolLoopAgent({ model, tools, allowSystemInMessages: true });");
    expect(src).toContain("export const shared = new ToolLoopAgent({\n  model,\n  tools,\n  allowSystemInMessages: true,\n});");
    // Provably system-free calls, an existing setting, and opaque options are left alone.
    expect(src).toContain("const plain = new ToolLoopAgent({ model, tools });");
    expect(src).toContain("generateText({ model, messages: [{ role: 'user', content: q }, { role: 'assistant', content: 'ok' }] });");
    expect(src).toContain("generateText({ model, prompt: q });");
    expect(src).toContain("generateText({ model, messages: history, allowSystemInMessages: true });\n}");
    expect(src).toContain("generateText({ model, ...extra });");
    expect(src.match(/allowSystemInMessages/g)).toHaveLength(7);
    // A second run finds nothing left to set.
    expect((await scanAndFix(dir)).result.findings.filter((f) => f.ruleId === "system-in-messages")).toEqual([]);
  });
});
