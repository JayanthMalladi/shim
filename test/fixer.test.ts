import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseReview } from "../src/agent.js";
import { rank, type Candidate } from "../src/candidates.js";
import { gateOrder } from "../src/gates.js";

const ok = { ok: true, code: 0, output: "", ms: 0 };
const fail = { ...ok, ok: false, code: 1 };
const cand = (dir: string, size: number, after: Candidate["after"], remaining = 0): Candidate => ({
  dir, size, after, agentRuns: [], remaining: Array(remaining).fill({}),
  ok: Object.values(after).every((r) => r.ok) && remaining === 0,
});

describe("parseReview", () => {
  it("reads the last JSON line", () => {
    expect(parseReview('Looks fine.\n{"approve": true, "issues": []}')).toEqual({ approve: true, issues: [] });
    expect(parseReview('{"approve": true}\nOn reflection:\n{"approve": false, "issues": ["a.ts:3 drops finalStep"]}'))
      .toEqual({ approve: false, issues: ["a.ts:3 drops finalStep"] });
  });
  it("treats a missing or broken verdict as a rejection", () => {
    expect(parseReview("I ran out of turns").approve).toBe(false);
    expect(parseReview('{"approve": tru').approve).toBe(false);
  });
});

describe("rank", () => {
  const baseline = { "typecheck .": ok, "test .": ok };
  it("prefers passing candidates, then the smallest diff", () => {
    const big = cand("big", 40, baseline);
    const small = cand("small", 6, baseline);
    const broken = cand("broken", 2, { "typecheck .": fail, "test .": ok });
    expect(rank([big, broken, small], baseline).map((c) => c.dir)).toEqual(["small", "big", "broken"]);
  });
  it("among failures, prefers fewer regressions, then fewer findings left", () => {
    const twoRed = cand("twoRed", 1, { "typecheck .": fail, "test .": fail });
    const oneRed = cand("oneRed", 9, { "typecheck .": fail, "test .": ok }, 2);
    const oneRedClean = cand("oneRedClean", 9, { "typecheck .": fail, "test .": ok });
    expect(rank([twoRed, oneRed, oneRedClean], baseline).map((c) => c.dir)).toEqual(["oneRedClean", "oneRed", "twoRed"]);
  });
});

describe("gateOrder", () => {
  it("checks the root, then published packages, then private demos", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shim-gates-"));
    const pkg = (rel: string, json: object) => {
      fs.mkdirSync(path.join(root, rel), { recursive: true });
      fs.writeFileSync(path.join(root, rel, "package.json"), JSON.stringify(json));
      return path.join(root, rel);
    };
    const demo = pkg("demos/a", { name: "a", private: true });
    const lib = pkg("packages/z-provider", { name: "z-provider" });
    expect(gateOrder(root, [demo, lib, root])).toEqual([root, lib, demo]);
  });
});
