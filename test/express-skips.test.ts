import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXPRESS_V5 } from "../src/migrations.js";
import { prepare } from "../src/pipeline.js";
import { expressPeerDependencySkip, installedExpressPeerSkip } from "../src/express-skips.js";

/** A temp dir with the given files (path -> JSON object), for package.json and node_modules fakes. */
function tmpRepo(files: Record<string, object>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "express-skips-"));
  for (const [rel, json] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), JSON.stringify(json, null, 2));
  }
  return dir;
}

describe("EXPRESS_V5.isOldMajor", () => {
  it.each([
    ["^4.21.0", true], ["~4.18.0", true], ["4.22.3", true], [">=4.0.0 <5", true],
    [">=4.0.0", false], ["^4.0.0 || ^5.0.0", false], ["^5.0.0", false], ["workspace:*", false], ["*", false],
  ])("%s is old-major: %s", (range, expected) => {
    expect(EXPRESS_V5.isOldMajor(range)).toBe(expected);
  });
});

describe("expressPeerDependencySkip", () => {
  it("skips a repo whose root package lists express as a peer", () => {
    const dir = tmpRepo({ "package.json": { name: "lib", peerDependencies: { express: "^4.18.0" } } });
    expect(expressPeerDependencySkip(dir)).toBe("express is a peerDependency: library needs dual v4/v5 support");
  });
  it("skips a repo whose workspace package lists express as a peer", () => {
    const dir = tmpRepo({
      "package.json": { name: "root", private: true },
      "packages/mw/package.json": { name: "mw", peerDependencies: { express: "^4.18.0" } },
    });
    expect(expressPeerDependencySkip(dir)).toBe("express is a peerDependency: library needs dual v4/v5 support");
  });
  it("does not skip a repo with express only in dependencies", () => {
    const dir = tmpRepo({ "package.json": { name: "app", dependencies: { express: "^4.21.0" } } });
    expect(expressPeerDependencySkip(dir)).toBeUndefined();
  });
});

describe("installedExpressPeerSkip", () => {
  it("skips when a top-level installed package needs express 4", () => {
    const dir = tmpRepo({ "node_modules/fake-mw/package.json": { name: "fake-mw", version: "1.2.3", peerDependencies: { express: "^4.18.0" } } });
    expect(installedExpressPeerSkip([dir])).toBe("fake-mw@1.2.3 requires express 4 (peer ^4.18.0)");
  });
  it.each([["^4.18.0 || ^5.0.0"], [">=4.0.0"], ["^5.0.0"]])("does not skip for peer range %s", (range) => {
    const dir = tmpRepo({ "node_modules/fake-mw/package.json": { name: "fake-mw", version: "1.0.0", peerDependencies: { express: range } } });
    expect(installedExpressPeerSkip([dir])).toBeUndefined();
  });
  it("ignores nested node_modules and express itself", () => {
    const dir = tmpRepo({
      "node_modules/a/package.json": { name: "a", version: "1.0.0" },
      "node_modules/a/node_modules/b/package.json": { name: "b", version: "1.0.0", peerDependencies: { express: "^4.0.0" } },
      "node_modules/express/package.json": { name: "express", version: "4.21.0", peerDependencies: { express: "^4.0.0" } },
    });
    expect(installedExpressPeerSkip([dir])).toBeUndefined();
  });
});

describe("prepare skips before install (express)", () => {
  it("express: peer dependency", async () => {
    const dir = tmpRepo({ "package.json": { name: "lib", peerDependencies: { express: "^4.18.0" }, devDependencies: { express: "^4.18.0" } } });
    expect(await prepare(dir, "x/lib", EXPRESS_V5)).toEqual({ skip: "express is a peerDependency: library needs dual v4/v5 support" });
  });
  it("express: already on 5", async () => {
    const dir = tmpRepo({ "package.json": { name: "app", dependencies: { express: "^5.1.0" } } });
    expect(await prepare(dir, "x/app", EXPRESS_V5)).toEqual({ skip: "already on express 5 (^5.1.0)" });
  });
  it("express: catalog ranges are not reported as express 5", async () => {
    const dir = tmpRepo({ "package.json": { name: "app", dependencies: { express: "catalog:" } } });
    expect(await prepare(dir, "x/app", EXPRESS_V5)).toEqual({ skip: "express version not in package.json (catalog:)" });
  });
  it("express: no express dependency", async () => {
    const dir = tmpRepo({ "package.json": { name: "app" } });
    expect(await prepare(dir, "x/app", EXPRESS_V5)).toEqual({ skip: "no express dependency" });
  });
});
