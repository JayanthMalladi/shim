import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { FORBIDDEN_MODEL_RE, resolveModel } from "../src/evolve-guard.js";

const MODEL_VARS = ["SHIM_FIXER_MODEL", "SHIM_REVIEWER_MODEL", "SHIM_JUDGE_MODEL", "SHIM_MUTATOR_MODEL"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const v of MODEL_VARS) { saved[v] = process.env[v]; delete process.env[v]; }
});
afterEach(() => {
  for (const v of MODEL_VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

describe("resolveModel", () => {
  it("returns the fallback when the role's env var is unset", () => {
    expect(resolveModel("judge", "claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(resolveModel("fixer", "claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(resolveModel("reviewer", "claude-haiku-5-5")).toBe("claude-haiku-5-5");
    expect(resolveModel("mutator", "claude-opus-5-5")).toBe("claude-opus-5-5");
  });

  it("uses the env var value when set to a non-empty string", () => {
    process.env.SHIM_JUDGE_MODEL = "custom-model";
    expect(resolveModel("judge", "claude-opus-5-5")).toBe("custom-model");
  });

  it("returns the fallback when the env var is set but empty", () => {
    process.env.SHIM_FIXER_MODEL = "";
    expect(resolveModel("fixer", "claude-opus-5-5")).toBe("claude-opus-5-5");
  });

  it("throws for every role when the resolved model contains 'fable' (case-insensitive)", () => {
    for (const role of ["fixer", "reviewer", "judge", "mutator"] as const) {
      process.env[`SHIM_${role.toUpperCase()}_MODEL`] = "fable-2";
      expect(() => resolveModel(role, "claude-opus-5-5")).toThrowError(/fable/);
    }
  });

  it("throws for every role when the resolved model contains 'mythos'", () => {
    for (const role of ["fixer", "reviewer", "judge", "mutator"] as const) {
      process.env[`SHIM_${role.toUpperCase()}_MODEL`] = "mythos-large";
      expect(() => resolveModel(role, "claude-opus-5-5")).toThrowError(/mythos/);
    }
  });

  it("throws even when the env var itself carries the forbidden name", () => {
    process.env.SHIM_REVIEWER_MODEL = "Mythos-Mini";
    expect(() => resolveModel("reviewer", "claude-opus-5-5")).toThrowError(/SHIM_REVIEWER_MODEL/);
  });

  it("FORBIDDEN_MODEL_RE matches case-insensitively", () => {
    expect(FORBIDDEN_MODEL_RE.test("FABLE")).toBe(true);
    expect(FORBIDDEN_MODEL_RE.test("mythos")).toBe(true);
    expect(FORBIDDEN_MODEL_RE.test("claude-opus-5-5")).toBe(false);
  });
});
