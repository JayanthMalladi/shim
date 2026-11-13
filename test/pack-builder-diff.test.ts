/**
 * S06: unit tests for the deterministic .d.ts surface diff (the evidence stage's core). No network,
 * no model, no target-repo: these exercise the pure diff of two exported-type surfaces, which is
 * what a generated pack is built from. The removed/added/changed cases mirror how a real major
 * (e.g. Zod 3 -> 4: ZodError gains/loses members, z gains a method) would surface.
 */
import { describe, expect, it } from "vitest";
import { diffSurfaces } from "../src/pack-builder/evidence.js";
import type { Surface } from "../src/pack-builder/types.js";

const surf = (exports: Array<[string, string]>): Surface => ({
  version: "x",
  files: ["index.d.ts"],
  exports: exports.map(([name, signature]) => ({ name, signature, file: "index.d.ts" })),
});

describe("S06 .d.ts surface diff", () => {
  it("reports an exported symbol removed in the new major", () => {
    const from = surf([["oldFn", "oldFn()"], ["shared", "shared()"]]);
    const to = surf([["shared", "shared()"]]);
    const d = diffSurfaces(from, to);
    expect(d.removed.map((r) => r.name)).toEqual(["oldFn"]);
    expect(d.added).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it("reports an exported symbol added in the new major", () => {
    const from = surf([["shared", "shared()"]]);
    const to = surf([["shared", "shared()"], ["newFn", "newFn()"]]);
    const d = diffSurfaces(from, to);
    expect(d.added.map((a) => a.name)).toEqual(["newFn"]);
    expect(d.removed).toEqual([]);
  });

  it("reports a signature change when an export keeps its name", () => {
    const from = surf([["z", "z { string | object }"]]);
    const to = surf([["z", "z { string | object | prefault }"]]);
    const d = diffSurfaces(from, to);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]).toMatchObject({ name: "z", fromSig: "z { string | object }", toSig: "z { string | object | prefault }" });
  });

  it("does not count an unchanged export as changed, removed, or added", () => {
    const from = surf([["z", "z { string }"], ["e", "e()"]]);
    const to = surf([["z", "z { string }"], ["e", "e()"]]);
    const d = diffSurfaces(from, to);
    expect(d.changed).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.added).toEqual([]);
  });

  it("folds a type that gains or loses a member into a changed signature (ZodError.errors -> .issues)", () => {
    // The members summary is what makes a member-only change visible in the diff.
    const from = surf([["ZodError", "ZodError { errors | name }"]]);
    const to = surf([["ZodError", "ZodError { issues | name }"]]);
    const d = diffSurfaces(from, to);
    expect(d.changed.map((c) => c.name)).toEqual(["ZodError"]);
    expect(d.removed).toEqual([]);
  });

  it("handles a symbol that is removed in one place and added in another (a pure rename)", () => {
    const from = surf([["uuid", "uuid()"]]);
    const to = surf([["guid", "guid()"]]);
    const d = diffSurfaces(from, to);
    expect(d.removed.map((r) => r.name)).toEqual(["uuid"]);
    expect(d.added.map((a) => a.name)).toEqual(["guid"]);
    // A rename is a remove + an add, not a signature change (the names differ).
    expect(d.changed).toEqual([]);
  });
});
