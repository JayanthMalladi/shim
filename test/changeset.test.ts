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

  it("root dir in pkgDirs with a publishable name → changeset written", () => {
    const { root, pkg, cs } = newRoot();
    pkg("package.json", '{ "name": "@acme/app", "dependencies": { "ai": "^6.0.0" } }');
    addChangeset(root, [root]);
    expect(fs.readFileSync(cs, "utf8")).toContain('"@acme/app": major');
  });

  it("does not strip a real package that contains the substring 'fake' (e.g. faker)", () => {
    const { root, pkg, cs } = newRoot();
    pkg("packages/faker/package.json", '{ "name": "faker", "dependencies": { "ai": "^6.0.0" } }');
    pkg("packages/faker-js/package.json", '{ "name": "@faker-js/faker", "dependencies": { "ai": "^6.0.0" } }');
    pkg("packages/fakeredis/package.json", '{ "name": "fakeredis", "dependencies": { "ai": "^6.0.0" } }');
    addChangeset(root, [path.join(root, "packages/faker"), path.join(root, "packages/faker-js"), path.join(root, "packages/fakeredis")]);
    const text = fs.readFileSync(cs, "utf8");
    expect(text).toContain('"faker": major');
    expect(text).toContain('"@faker-js/faker": major');
    expect(text).toContain('"fakeredis": major');
  });

  it("treats the literal string 'placeholder' as a placeholder (not 'placeholder-x')", () => {
    const { root, pkg, cs } = newRoot();
    pkg("package.json", '{ "name": "@acme/app", "dependencies": { "ai": "^6.0.0" } }');
    pkg("packages/a/package.json", '{ "name": "placeholder", "dependencies": { "ai": "^6.0.0" } }');
    pkg("packages/b/package.json", '{ "name": "placeholder-x", "dependencies": { "ai": "^6.0.0" } }');
    addChangeset(root, [path.join(root, "packages/a"), path.join(root, "packages/b")]);
    const text = fs.readFileSync(cs, "utf8");
    // The literal "placeholder" is stripped; "placeholder-x" is a real package name and kept.
    expect(text).not.toContain('"placeholder": major');
    expect(text).toContain('"placeholder-x": major');
  });

  it("no changeset when only placeholder packages changed and root is not in pkgDirs", () => {
    const { root, pkg, cs } = newRoot();
    pkg("package.json", '{ "name": "@acme/app", "dependencies": { "ai": "^6.0.0" } }');
    pkg("packages/a/package.json", '{ "name": "@fake-scope/fake-pkg", "dependencies": { "ai": "^6.0.0" } }');
    addChangeset(root, [path.join(root, "packages/a")]);
    // Root is NOT in pkgDirs → no changeset (we do not ship a major for an unchanged container).
    expect(fs.existsSync(cs)).toBe(false);
  });

  it("writes nothing when no published name is available", () => {
    const { root, pkg, cs } = newRoot();
    pkg("package.json", '{ "name": "test", "private": true }');
    pkg("packages/a/package.json", '{ "name": "test", "private": true }');
    addChangeset(root, [path.join(root, "packages/a")]);
    expect(fs.existsSync(cs)).toBe(false);
  });
});
