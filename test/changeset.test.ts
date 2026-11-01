import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addChangeset } from "../src/pipeline.js";

const newRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shim-cs-"));
  fs.mkdirSync(path.join(root, ".changeset"), { recursive: true });
  fs.writeFileSync(path.join(root, ".changeset", "config.json"), "{}\n");
  const pkg = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  return { root, pkg, cs: path.join(root, ".changeset", "upgrade-ai-sdk-7.md") };
};

describe("addChangeset", () => {
  it("writes a major changeset for published packages", () => {
    const { root, pkg, cs } = newRoot();
    pkg("packages/a/package.json", '{ "name": "@acme/a", "dependencies": { "ai": "^6.0.0" } }');
    pkg("packages/b/package.json", '{ "name": "@acme/b", "private": true }');
    addChangeset(root, [path.join(root, "packages/a"), path.join(root, "packages/b")]);
    expect(fs.readFileSync(cs, "utf8")).toContain('"@acme/a": major');
    expect(fs.readFileSync(cs, "utf8")).not.toContain('"@acme/b"');
  });

  it("skips a placeholder name and falls back to the root package name", () => {
    const { root, pkg, cs } = newRoot();
    pkg("package.json", '{ "name": "@acme/app", "dependencies": { "ai": "^6.0.0" } }');
    pkg("packages/a/package.json", '{ "name": "@fake-scope/fake-pkg", "dependencies": { "ai": "^6.0.0" } }');
    addChangeset(root, [path.join(root, "packages/a")]);
    expect(fs.readFileSync(cs, "utf8")).toContain('"@acme/app": major');
    expect(fs.readFileSync(cs, "utf8")).not.toContain("fake");
  });

  it("writes nothing when no published name is available", () => {
    const { root, pkg, cs } = newRoot();
    pkg("package.json", '{ "name": "test", "private": true }');
    pkg("packages/a/package.json", '{ "name": "test", "private": true }');
    addChangeset(root, [path.join(root, "packages/a")]);
    expect(fs.existsSync(cs)).toBe(false);
  });
});
