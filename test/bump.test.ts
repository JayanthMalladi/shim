import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allowsMajor, bumpAiSdk, bumpExpress, bumpZod } from "../src/bump.js";

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

describe("bumpZod", () => {
  it("bumps zod 3 ranges in dependencies and devDependencies only, in place", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shim-bump-zod-"));
    const write = (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    };
    write("package.json", '{\n    "name": "root",\n    "dependencies": {\n        "zod": "^3.22.4"\n    }\n}\n');
    write("packages/a/package.json", '{ "devDependencies": { "zod": "3.25.76" }, "peerDependencies": { "zod": "^3.22.0" } }');
    write("packages/b/package.json", '{ "dependencies": { "zod": "^4.1.0" }, "devDependencies": { "zod-to-json-schema": "^3.24.0" } }');
    write("packages/c/package.json", '{ "dependencies": { "zod": "^3.25.0 || ^4.0.0" } }');
    write("packages/d/package.json", '{ "dependencies": { "zod": "catalog:" } }');
    write("node_modules/x/package.json", '{ "dependencies": { "zod": "^3.0.0" } }');

    expect(bumpZod(root).sort()).toEqual([
      "zod (package.json, dependencies): ^3.22.4 -> ^4.0.0",
      "zod (packages/a/package.json, devDependencies): 3.25.76 -> ^4.0.0",
    ]);
    const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
    expect(read("package.json")).toBe('{\n    "name": "root",\n    "dependencies": {\n        "zod": "^4.0.0"\n    }\n}\n');
    expect(read("packages/a/package.json")).toBe('{ "devDependencies": { "zod": "^4.0.0" }, "peerDependencies": { "zod": "^3.22.0" } }');
    expect(read("packages/b/package.json")).toBe('{ "dependencies": { "zod": "^4.1.0" }, "devDependencies": { "zod-to-json-schema": "^3.24.0" } }');
    expect(read("packages/c/package.json")).toBe('{ "dependencies": { "zod": "^3.25.0 || ^4.0.0" } }');
    expect(read("packages/d/package.json")).toBe('{ "dependencies": { "zod": "catalog:" } }');
    expect(read("node_modules/x/package.json")).toContain("^3.0.0");
  });
});

describe("bumpExpress", () => {
  it("bumps express 4 ranges and the matching @types in dependencies and devDependencies only, in place", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shim-bump-express-"));
    const write = (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    };
    write("package.json", '{\n    "name": "root",\n    "dependencies": {\n        "express": "^4.21.0",\n        "@types/express": "^4.17.21"\n    }\n}\n');
    write("packages/a/package.json", '{ "devDependencies": { "express": "4.22.3", "@types/express-serve-static-core": "^4.17.40" }, "peerDependencies": { "express": "^4.18.0" } }');
    write("packages/b/package.json", '{ "dependencies": { "express": "^5.0.0" }, "devDependencies": { "@types/express": "^5.0.0" } }');
    write("packages/c/package.json", '{ "dependencies": { "express": "^4.0.0 || ^5.0.0" } }');
    write("packages/d/package.json", '{ "dependencies": { "express": "catalog:" } }');
    write("node_modules/x/package.json", '{ "dependencies": { "express": "^4.0.0" } }');

    expect(bumpExpress(root).sort()).toEqual([
      "@types/express (package.json, dependencies): ^4.17.21 -> ^5.0.0",
      "@types/express-serve-static-core (packages/a/package.json, devDependencies): ^4.17.40 -> ^5.0.0",
      "express (package.json, dependencies): ^4.21.0 -> ^5.0.0",
      "express (packages/a/package.json, devDependencies): 4.22.3 -> ^5.0.0",
    ]);
    const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
    // express + the @types in the same field are rewritten; the file's own formatting survives.
    expect(read("package.json")).toBe('{\n    "name": "root",\n    "dependencies": {\n        "express": "^5.0.0",\n        "@types/express": "^5.0.0"\n    }\n}\n');
    expect(read("packages/a/package.json")).toBe('{ "devDependencies": { "express": "^5.0.0", "@types/express-serve-static-core": "^5.0.0" }, "peerDependencies": { "express": "^4.18.0" } }');
    // Already on 5, already-allows-5, catalog: and node_modules are untouched.
    expect(read("packages/b/package.json")).toBe('{ "dependencies": { "express": "^5.0.0" }, "devDependencies": { "@types/express": "^5.0.0" } }');
    expect(read("packages/c/package.json")).toBe('{ "dependencies": { "express": "^4.0.0 || ^5.0.0" } }');
    expect(read("packages/d/package.json")).toBe('{ "dependencies": { "express": "catalog:" } }');
    expect(read("node_modules/x/package.json")).toContain("^4.0.0");
  });
});
