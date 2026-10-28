import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  totalSpent,
  estimateNext,
  wouldExceedBudget,
  sanitizeModels,
  ALLOWED_MODELS,
  bound,
  GENOME_BOUNDS,
  syncMirror,
  type ArchiveEntry,
} from "../src/evolve-guard.js";
import { run } from "../src/exec.js";

const D = { fixerModel: "claude-opus-5-5", reviewerModel: "claude-opus-5-5" };

describe("totalSpent", () => {
  it("sums every completed evaluation's cost", () => {
    const s: ArchiveEntry[] = [
      { id: "v1", cost: 20 },
      { id: "v2", cost: 55 },
    ];
    expect(totalSpent(s)).toBe(75);
    expect(totalSpent([...s, { id: "g1-v2-ab12", parent: "v2", cost: 40 }])).toBe(115);
    expect(totalSpent([])).toBe(0);
  });
});

describe("estimateNext", () => {
  const seeds: ArchiveEntry[] = [
    { id: "v1", cost: 20 },
    { id: "v2", cost: 55 },
  ];
  it("estimates a child by its parent's cost", () => {
    expect(estimateNext([...seeds, { id: "g1-v2-ab12", parent: "v2", cost: 40 }], "v2")).toBe(55);
  });
  it("estimates a seed by the most expensive seed so far", () => {
    expect(estimateNext(seeds)).toBe(55);
    expect(estimateNext([seeds[0]!])).toBe(20);
  });
  it("returns 0 when nothing has run, so the first seed always starts", () => {
    expect(estimateNext([])).toBe(0);
  });
  it("falls back to the seed estimate when the parent is unknown", () => {
    expect(estimateNext([...seeds, { id: "g1-v2-ab12", parent: "v2", cost: 40 }], "never-seen")).toBe(55);
  });
});

describe("sanitizeModels", () => {
  it("lets allowlisted models through untouched", () => {
    for (const m of ALLOWED_MODELS)
      expect(sanitizeModels({ fixerModel: m, reviewerModel: m }, D)).toEqual({ fixerModel: m, reviewerModel: m, clamped: [] });
  });
  it("clamps Fable or Mythos ids back to the default and records which fields", () => {
    expect(sanitizeModels({ fixerModel: "claude-fable-5-1", reviewerModel: "claude-mythos-5-1" }, D))
      .toEqual({ fixerModel: D.fixerModel, reviewerModel: D.reviewerModel, clamped: ["fixerModel", "reviewerModel"] });
  });
  it("falls back to the default when a model is absent, without flagging it", () => {
    expect(sanitizeModels({}, D)).toEqual({ fixerModel: D.fixerModel, reviewerModel: D.reviewerModel, clamped: [] });
  });
  it("clamps a single offending field and leaves the other alone", () => {
    expect(sanitizeModels({ fixerModel: "claude-gpt-9", reviewerModel: "claude-haiku-5-5" }, D))
      .toEqual({ fixerModel: D.fixerModel, reviewerModel: "claude-haiku-5-5", clamped: ["fixerModel"] });
  });
});

describe("bound", () => {
  it("clamps out-of-range values to the range edges", () => {
    expect(bound(99, GENOME_BOUNDS.candidates, 3)).toBe(4);
    expect(bound(0, GENOME_BOUNDS.candidates, 3)).toBe(1);
    expect(bound(7, GENOME_BOUNDS.attempts, 2)).toBe(3);
    expect(bound(400, GENOME_BOUNDS.fixerMaxTurns, 40)).toBe(60);
    expect(bound(9, GENOME_BOUNDS.reviewRounds, 0)).toBe(2);
  });
  it("rounds fractional values and keeps in-range values intact", () => {
    expect(bound(2.4, GENOME_BOUNDS.candidates, 3)).toBe(2);
    expect(bound(1, GENOME_BOUNDS.attempts, 2)).toBe(1);
  });
  it("falls back to the default when the value does not parse", () => {
    expect(bound(undefined, GENOME_BOUNDS.attempts, 2)).toBe(2);
    expect(bound("garbage", GENOME_BOUNDS.attempts, 2)).toBe(2);
    expect(bound(null, GENOME_BOUNDS.reviewRounds, 0)).toBe(0);
  });
  it("keeps the seed values inside the bounds", () => {
    expect(bound(3, GENOME_BOUNDS.candidates, 3)).toBe(3);
  });
});

describe("wouldExceedBudget", () => {
  it("stops when spent plus the estimate passes the budget", () => {
    expect(wouldExceedBudget({ spent: 100, estimate: 55, budgetUsd: 150 })).toBe(true);
    expect(wouldExceedBudget({ spent: 100, estimate: 55, budgetUsd: 155 })).toBe(false);
  });
  it("a fresh run with no spend fits any budget", () => {
    expect(wouldExceedBudget({ spent: 0, estimate: 0, budgetUsd: 1 })).toBe(false);
  });
});

describe("syncMirror", () => {
  it("copies into a plain folder (no git)", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "shim-mirror-out-"));
    const mirror = fs.mkdtempSync(path.join(os.tmpdir(), "shim-mirror-"));
    fs.writeFileSync(path.join(out, "LOG.md"), "# log v1");
    fs.writeFileSync(path.join(out, "archive.jsonl"), "{}\n");
    const status = syncMirror(mirror, out, "2026");
    expect(status).toMatch(/copied/);
    expect(fs.readFileSync(path.join(mirror, "LOG.md"), "utf8")).toBe("# log v1");
    expect(fs.readFileSync(path.join(mirror, "archive.jsonl"), "utf8")).toBe("{}\n");
  });

  it("commits and pushes into a git checkout on a results branch", () => {
    // A bare origin to push into.
    const origin = fs.mkdtempSync(path.join(os.tmpdir(), "shim-mirror-origin-"));
    run("git", ["init", "-q", "--bare", origin], os.tmpdir());
    const mirror = fs.mkdtempSync(path.join(os.tmpdir(), "shim-mirror-git-"));
    const git = (...a: string[]) => run("git", a, mirror);
    git("init", "-q");
    git("remote", "add", "origin", origin);
    git("checkout", "-qb", "results");
    git("commit", "-q", "--allow-empty", "-m", "init");
    git("push", "-q", "origin", "results");

    const out = fs.mkdtempSync(path.join(os.tmpdir(), "shim-mirror-out2-"));
    fs.writeFileSync(path.join(out, "LOG.md"), "# log v2");
    fs.writeFileSync(path.join(out, "archive.jsonl"), "{}\n");

    expect(syncMirror(mirror, out, "2026")).toBe("committed and pushed");
    // The result must be present on the remote branch.
    expect(git("ls-files").output).toContain("LOG.md");
    expect(git("show", "HEAD:LOG.md").output).toContain("# log v2");

    // A second sync with the same log is a clean no-op: nothing to commit.
    expect(syncMirror(mirror, out, "2026")).toBe("copied (no changes to commit)");
  });
});
