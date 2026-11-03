import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AI_SDK_V7, ZOD_V4 } from "../src/migrations.js";
import { prepare } from "../src/pipeline.js";
import { installedPeerSkip, zodPeerDependencySkip } from "../src/zod-skips.js";

/** A temp dir with the given files (path -> JSON object), for package.json and node_modules fakes. */
function tmpRepo(files: Record<string, object>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zod-skips-"));
  for (const [rel, json] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), JSON.stringify(json, null, 2));
  }
  return dir;
}

describe("ZOD_V4.isOldMajor", () => {
  it.each([
    ["^3.25.0", true], ["~3.22.4", true], ["3.25.76", true], [">=3.20.0 <4", true],
    [">=3.20.0", false], ["^3.25.0 || ^4.0.0", false], ["^4.0.0", false], ["workspace:*", false], ["*", false], ["latest", false],
  ])("%s is old-major: %s", (range, expected) => {
    expect(ZOD_V4.isOldMajor(range)).toBe(expected);
  });
});

describe("zodPeerDependencySkip", () => {
  it("skips a repo whose root package lists zod as a peer", () => {
    const dir = tmpRepo({ "package.json": { name: "lib", peerDependencies: { zod: "^3.22.0" } } });
    expect(zodPeerDependencySkip(dir)).toBe("zod is a peerDependency: library needs dual v3/v4 support");
  });
  it("skips a repo whose workspace package lists zod as a peer", () => {
    const dir = tmpRepo({
      "package.json": { name: "root", private: true },
      "packages/lib/package.json": { name: "lib", peerDependencies: { zod: "^3.22.0" } },
    });
    expect(zodPeerDependencySkip(dir)).toBe("zod is a peerDependency: library needs dual v3/v4 support");
  });
  it("does not skip a repo with zod only in dependencies", () => {
    const dir = tmpRepo({ "package.json": { name: "app", dependencies: { zod: "^3.22.0" } } });
    expect(zodPeerDependencySkip(dir)).toBeUndefined();
  });
});

describe("installedPeerSkip", () => {
  it("skips when a top-level installed package needs zod 3", () => {
    const dir = tmpRepo({ "node_modules/fake-lib/package.json": { name: "fake-lib", version: "1.2.3", peerDependencies: { zod: "^3.22.0" } } });
    expect(installedPeerSkip([dir])).toBe("fake-lib@1.2.3 requires zod 3 (peer ^3.22.0)");
  });
  it("checks scoped packages", () => {
    const dir = tmpRepo({ "node_modules/@acme/x/package.json": { name: "@acme/x", version: "0.1.0", peerDependencies: { zod: "^3.0.0" } } });
    expect(installedPeerSkip([dir])).toBe("@acme/x@0.1.0 requires zod 3 (peer ^3.0.0)");
  });
  it.each([["^3.25.0 || ^4.0.0"], [">=3.0.0"], ["^4.0.0"]])("does not skip for peer range %s", (range) => {
    const dir = tmpRepo({ "node_modules/fake-lib/package.json": { name: "fake-lib", version: "1.0.0", peerDependencies: { zod: range } } });
    expect(installedPeerSkip([dir])).toBeUndefined();
  });
  it("ignores nested node_modules, dot folders, and zod itself", () => {
    const dir = tmpRepo({
      "node_modules/a/package.json": { name: "a", version: "1.0.0" },
      "node_modules/a/node_modules/b/package.json": { name: "b", version: "1.0.0", peerDependencies: { zod: "^3.0.0" } },
      "node_modules/.pnpm/c/package.json": { name: "c", version: "1.0.0", peerDependencies: { zod: "^3.0.0" } },
      "node_modules/zod/package.json": { name: "zod", version: "3.25.76", peerDependencies: { zod: "^3.0.0" } },
    });
    expect(installedPeerSkip([dir])).toBeUndefined();
  });
  it("returns undefined when there is no node_modules", () => {
    expect(installedPeerSkip([tmpRepo({ "package.json": { name: "app" } })])).toBeUndefined();
  });
});

describe("prepare skips before install", () => {
  it("zod: peer dependency", async () => {
    const dir = tmpRepo({ "package.json": { name: "lib", peerDependencies: { zod: "^3.22.0" }, devDependencies: { zod: "^3.22.0" } } });
    expect(await prepare(dir, "x/lib", ZOD_V4)).toEqual({ skip: "zod is a peerDependency: library needs dual v3/v4 support" });
  });
  it("zod: already on 4", async () => {
    const dir = tmpRepo({ "package.json": { name: "app", dependencies: { zod: "^4.1.0" } } });
    expect(await prepare(dir, "x/app", ZOD_V4)).toEqual({ skip: "already on zod 4 (^4.1.0)" });
  });
  it("zod: no zod dependency", async () => {
    const dir = tmpRepo({ "package.json": { name: "app" } });
    expect(await prepare(dir, "x/app", ZOD_V4)).toEqual({ skip: "no zod dependency" });
  });
  it("AI SDK: message unchanged", async () => {
    const dir = tmpRepo({ "package.json": { name: "app", dependencies: { ai: "^7.0.0" } } });
    expect(await prepare(dir, "x/app", AI_SDK_V7)).toEqual({ skip: "not on ai@6 (^7.0.0)" });
  });
});
