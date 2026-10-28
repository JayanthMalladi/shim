import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allowsMajor, bumpAiSdk } from "../src/bump.js";

describe("allowsMajor", () => {
  it.each([
    ["^7.0.11", true], ["~7.1.0", true], ["7.0.3", true], [">=6.0.0", true], [">=6.0.0 <8", true],
    ["^6 || ^7", true], ["5 || 6 || 7", true], ["*", true],
    ["^6.0.42", false], ["6.0.300", false], [">=6.0.182 <7", false], ["^5.0.0 || ^6.0.0", false],
  ])("%s allows 7: %s", (range, expected) => {
    expect(allowsMajor(range, 7)).toBe(expected);
  });
});

describe("bumpAiSdk", () => {
  const latest = (pkg: string) => ({ "@ai-sdk/anthropic": "^4.0.0", "@ai-sdk/openai": "^4.0.0", "@ai-sdk/google": "^4.0.0" })[pkg as "@ai-sdk/google"];

  it("bumps @ai-sdk/* in every package.json, including ones that don't use ai", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shim-bump-"));
    const write = (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    };
    // A monorepo root with no `ai` of its own, a package that uses ai, and one that is already on the target major.
    write("package.json", '{\n  "devDependencies": {\n    "@ai-sdk/anthropic": "^3.0.0"\n  }\n}\n');
    write("packages/a/package.json", '{\n  "dependencies": { "ai": "^6.0.0", "@ai-sdk/openai": "^3.0.0", "@ai-sdk/provider": "workspace:*" }\n}\n');
    write("packages/b/package.json", '{ "dependencies": { "@ai-sdk/google": "^4.1.0", "@ai-sdk/openai": "catalog:" } }');
    write("node_modules/x/package.json", '{ "dependencies": { "@ai-sdk/anthropic": "^3.0.0" } }');

    const changes = bumpAiSdk(root, latest);
    expect(changes.sort()).toEqual([
      "@ai-sdk/anthropic (package.json, devDependencies): ^3.0.0 -> ^4.0.0",
      "@ai-sdk/openai (packages/a/package.json, dependencies): ^3.0.0 -> ^4.0.0",
      "ai (packages/a/package.json, dependencies): ^6.0.0 -> ^7.0.0",
    ]);
    const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
    expect(read("package.json")).toBe('{\n  "devDependencies": {\n    "@ai-sdk/anthropic": "^4.0.0"\n  }\n}\n');
    expect(read("packages/a/package.json")).toContain('"@ai-sdk/provider": "workspace:*"');
    // Already allows the target major, or isn't a range: untouched, formatting included.
    expect(read("packages/b/package.json")).toBe('{ "dependencies": { "@ai-sdk/google": "^4.1.0", "@ai-sdk/openai": "catalog:" } }');
    expect(read("node_modules/x/package.json")).toContain("^3.0.0");
  });
});
