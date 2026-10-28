import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scan, scanAndFix } from "../src/scan.js";
import { run } from "../src/exec.js";

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
      "src/typed.ts:51", // streamText result declared with a type: reported once, by this rule
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

  it("flags reads on values declared with an AI SDK result type, for the agent, with no rewrite", () => {
    expect(at("typed-multi-step-result")).toEqual([
      "src/typed.ts:14", // Awaited<ReturnType<typeof generateText>>: response.messages
      "src/typed.ts:15", // .usage
      "src/typed.ts:16", // .warnings
      "src/typed.ts:20", // GenerateTextResult, destructured toolCalls
      "src/typed.ts:21", // StreamTextResult, optional-chained .sources
      "src/typed.ts:44", // property typed Awaited<ReturnType<typeof streamText>>
    ]);
    // Not flagged: .text, a field on the repo's own types, and a variable the tracker already owns (line 51).
    expect(result.findings.filter((f) => f.ruleId === "typed-multi-step-result").every((f) => f.fix === "agent" && f.severity === "silent")).toBe(true);
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

  it("flags CI node versions below 22 on PR- or push-triggered workflows, not on others", () => {
    // Findings are relative to the root; normalize separators so the assertion holds on Windows too.
    const ciAt = () => at("ci-node-version").map((l) => l.replace(/\\/g, "/"));
    // CI runs on Node 18/20 go red for the AI SDK 7 upgrade, so the low versions are flagged and rewritten.
    expect(ciAt()).toEqual([
      ".github/workflows/ci.yml:11", // scalar node-version: '20'
      ".github/workflows/ci.yml:17", // inline matrix [18, 20, 22]
      ".github/workflows/nvmrc.yml:10", // node-version-file: .nvmrc (= 18): manual, never edited
    ]);
    // Not flagged: 22, lts/*, an expression over ['lts/*', 'latest'], and a release-only workflow.
    expect(ciAt()).not.toContain(".github/workflows/ok.yml:9");
    expect(ciAt()).not.toContain(".github/workflows/ok.yml:15");
    expect(ciAt()).not.toContain(".github/workflows/ok.yml:24");
    expect(ciAt()).not.toContain(".github/workflows/publish.yml:11");
  });
});

describe("auto fixes", () => {
  it("rewrites generateText reads to keep v6 behavior", async () => {
    const dir = copyFixture();
    const { applied } = await scanAndFix(dir);
    const src = fs.readFileSync(path.join(dir, "src/agent.ts"), "utf8");
    // 12 code rewrites + 2 CI node-version rewrites (scalar '20'->'22', matrix [18,20,22]->[22]).
    expect(applied).toBe(5 + 7 + 2);
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

  it("rewrites CI node versions to 22, keeps quoting and leaves clean workflows alone", async () => {
    const dir = copyFixture();
    await scanAndFix(dir);
    const ci = fs.readFileSync(path.join(dir, ".github", "workflows", "ci.yml"), "utf8");
    expect(ci).toContain("node-version: '22'"); // the scalar kept its quotes
    expect(ci).toContain("node-version: [22]"); // [18, 20, 22] dropped the low entries
    expect(ci).toContain("node-version: ${{ matrix.node-version }}"); // the expression stayed
    // ok.yml (22, lts/*, the expression over ['lts/*', 'latest']) and the release-only publish.yml are untouched.
    expect(fs.readFileSync(path.join(dir, ".github", "workflows", "ok.yml"), "utf8"))
      .toBe(fs.readFileSync(path.join(fixture, ".github", "workflows", "ok.yml"), "utf8"));
    expect(fs.readFileSync(path.join(dir, ".github", "workflows", "publish.yml"), "utf8"))
      .toBe(fs.readFileSync(path.join(fixture, ".github", "workflows", "publish.yml"), "utf8"));
    // node-version-file is flagged but never edited: the .nvmrc is still 18.
    expect(fs.readFileSync(path.join(dir, ".nvmrc"), "utf8").trim()).toBe("18");
    // A second run finds nothing more to rewrite.
    const r2 = await scanAndFix(dir);
    expect(r2.result.findings.filter((f) => f.ruleId === "ci-node-version" && f.fix === "auto")).toEqual([]);
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

describe("source file loading (gitignored build outputs are not scanned)", () => {
  // A call that runs more than one step and reads usage: the `multi-step-result` rule flags it.
  const TRIGGER = `import { generateText, stepCountIs } from "ai";
declare const model: any;
export async function run() {
  const result = await generateText({ model, stopWhen: stepCountIs(2) });
  return result.usage.totalTokens;
}
`;
  // Finding files are relative to the root; normalize separators so the assertions hold on Windows too.
  const flagFiles = (result: ReturnType<typeof scan>["result"]) =>
    new Set(result.findings.map((f) => f.file.split(path.sep).join("/")));

  /** git init, a package.json with ai@6, and a commit; `tracked` source files each hold the trigger call. */
  const writeRepo = (dir: string, ignore: string, tracked: string[]) => {
    const git = (...args: string[]) => run("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], dir);
    git("init", "-q");
    for (const f of tracked) fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    for (const f of tracked) fs.writeFileSync(path.join(dir, f), TRIGGER);
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", private: true, dependencies: { ai: "^6.0.0" } }));
    fs.writeFileSync(path.join(dir, ".gitignore"), ignore);
    git("add", "-A");
    git("commit", "-q", "-m", "init");
  };

  it("flags tracked source but not gitignored build output", () => {
    // The .output dir is gitignored but NOT in the scanner's name filter, so only the
    // git-based file list excludes it: this is the case the fix actually addresses.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-git1-"));
    writeRepo(dir, ".output/\ndist/\nnode_modules/\n", ["src/main.ts"]);
    fs.mkdirSync(path.join(dir, ".output"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".output", "out.mjs"), TRIGGER); // gitignored, so not loaded
    const files = flagFiles(scan(dir).result);
    expect(files.has("src/main.ts")).toBe(true);
    expect([...files].some((f) => f.startsWith(".output/"))).toBe(false);
  });

  it("includes an untracked source file that is not ignored", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-git2-"));
    writeRepo(dir, "dist/\n", ["src/main.ts"]);
    fs.writeFileSync(path.join(dir, "src", "new.ts"), TRIGGER); // created after the commit, not ignored
    const files = flagFiles(scan(dir).result);
    expect(files.has("src/main.ts")).toBe(true);
    expect(files.has("src/new.ts")).toBe(true);
  });

  it("drops node_modules files even when git tracks them", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-git3-"));
    // node_modules is NOT in .gitignore here, so git's list includes it; the name filter must still drop it.
    writeRepo(dir, "dist/\n", ["src/main.ts", "node_modules/pkg/index.js"]);
    const files = flagFiles(scan(dir).result);
    expect(files.has("src/main.ts")).toBe(true);
    expect([...files].some((f) => f.startsWith("node_modules/"))).toBe(false);
  });

  it("falls back to a filesystem walk outside a git repo, still skipping dist", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-nogit-"));
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "main.ts"), TRIGGER);
    fs.writeFileSync(path.join(dir, "dist", "out.mjs"), TRIGGER);
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", private: true, dependencies: { ai: "^6.0.0" } }));
    const files = flagFiles(scan(dir).result);
    expect(files.has("src/main.ts")).toBe(true);
    expect(files.has("dist/out.mjs")).toBe(false);
  });

  it("walks a folder that sits inside an ignored directory of an outer repo", () => {
    // The scan root (work/x) has no .git of its own; the outer repo gitignores work/.
    // git ls-files would succeed against the outer repo and return nothing for this root,
    // so the filesystem walk must be used instead. Guards against the zero-file-scan regression.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-git4-"));
    writeRepo(dir, "work/\n", []);
    fs.mkdirSync(path.join(dir, "work", "x", "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "work", "x", "src", "a.ts"), TRIGGER);
    const { result } = scan(path.join(dir, "work", "x"));
    expect(result.filesScanned).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.ruleId === "multi-step-result")).toBe(true);
    expect(flagFiles(result).has("src/a.ts")).toBe(true);
  });

  it("scans a tracked file whose name is not ASCII", () => {
    // ls-files without -z quotes non-ASCII paths (e.g. "src/\303\274bung.ts") and drops them;
    // with -z they come back NUL-separated and intact.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-git5-"));
    writeRepo(dir, "dist/\n", ["src/übung.ts"]);
    const files = flagFiles(scan(dir).result);
    expect(files.has("src/übung.ts")).toBe(true);
  });
});
