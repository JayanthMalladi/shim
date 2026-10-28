import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  totalSpent,
  inFlightCost,
  estimateNext,
  wouldExceedBudget,
  shouldStopForBudget,
  sanitizeModels,
  ALLOWED_MODELS,
  bound,
  GENOME_BOUNDS,
  syncMirror,
  type ArchiveEntry,
} from "../src/evolve-guard.js";
import { run } from "../src/exec.js";

const D = { fixerModel: "claude-opus-5-5", reviewerModel: "claude-opus-5-5" };

const T = "2026-02-01T00:00:00.000Z"; // every fixture timestamp below parses to Date.parse(T)

describe("totalSpent", () => {
  it("sums every completed evaluation's cost", () => {
    const s: ArchiveEntry[] = [
      { id: "v1", cost: 20, at: T, set: "dev" },
      { id: "v2", cost: 55, at: T, set: "dev" },
    ];
    expect(totalSpent(s)).toBe(75);
    expect(totalSpent([...s, { id: "g1-v2-ab12", parent: "v2", cost: 40, at: T, set: "dev" }])).toBe(115);
    expect(totalSpent([])).toBe(0);
  });
});

describe("inFlightCost", () => {
  const cut = Date.parse(T);
  const v1Dev = { id: "v1", cost: 30, at: T, set: "dev" };
  it("counts every result file when the arch has no archive entry yet", () => {
    // No archive entry: no cutoff, so every result file is live spend, judge cost included.
    expect(inFlightCost([], "v1", [
      { mtimeMs: 1, cost: 5, judgeCost: 1 },
      { mtimeMs: 2, cost: 7 },
    ])).toBe(13);
  });
  it("does not double-count a holdout rerun of an archived arch", () => {
    const arch = [{ ...v1Dev, at: T, set: "holdout" }];
    const newer = { mtimeMs: cut + 1, cost: 8, judgeCost: 2 };
    // The re-run's fresh result file is newer than the holdout entry.
    expect(inFlightCost(arch, "v1", [newer])).toBe(10);
    // An older file belongs to the archived dev run already in totalSpent.
    expect(inFlightCost(arch, "v1", [{ mtimeMs: 1, cost: 5, judgeCost: 1 }, newer])).toBe(10);
    // A file that finishes at the exact cutoff moment is not newer: not counted.
    expect(inFlightCost(arch, "v1", [{ mtimeMs: cut, cost: 99 }])).toBe(0);
    // The cutoff looks at every set: an older entry from another set is no shelter.
    const devOnly = [v1Dev];
    expect(inFlightCost(devOnly, "v1", [newer])).toBe(10);
  });
  it("an invalid rerun counts only the re-run's fresh files", () => {
    const arch = [
      { ...v1Dev, at: T, set: "dev" },
      { id: "v1", cost: 0, at: "2026-02-02T00:00:00.000Z", set: "dev", invalid: "2 repos errored or rate limited" },
    ];
    // Cutoff is the newest entry (the invalid one); older files are already in the archive.
    expect(inFlightCost(arch, "v1", [
      { mtimeMs: 1, cost: 30 },
      { mtimeMs: Date.parse("2026-02-02T00:00:00.000Z") + 1, cost: 4, judgeCost: 1 },
    ])).toBe(5);
  });
});

describe("estimateNext", () => {
  const dev: ArchiveEntry[] = [
    { id: "v1", cost: 20, at: T, set: "dev" },
    { id: "v2", cost: 55, at: T, set: "dev" },
  ];
  it("estimates a child by its parent's cost", () => {
    const child = { id: "g1-v2-ab12", parent: "v2", cost: 40, at: T, set: "dev" };
    expect(estimateNext([...dev, child], "v2", "dev", 3)).toBe(55);
  });
  it("falls back to the set's average evaluation cost, times the repos to run", () => {
    expect(estimateNext(dev, undefined, "dev", 3)).toBe(112.5); // (20+55)/2 * 3
    expect(estimateNext(dev, undefined, "dev", 4)).toBe(150); // (20+55)/2 * 4
  });
  it("does not mix sets: other sets and invalid runs are not eligible", () => {
    const withOther = [
      ...dev,
      { id: "h1", cost: 200, at: T, set: "holdout" },
      { id: "v3", cost: 900, at: T, set: "dev", invalid: "1 repos errored or rate limited" },
    ];
    expect(estimateNext(withOther, undefined, "dev", 3)).toBe(112.5);
    expect(estimateNext(withOther, undefined, "holdout", 2)).toBe(400); // 200/1 * 2
  });
  it("an unknown, invalid, or other-set parent falls back to the set average", () => {
    const entries = [
      ...dev,
      { id: "h1", cost: 200, at: T, set: "holdout" },
      { id: "g2-v2-cd34", parent: "v2", cost: 80, at: T, set: "dev", invalid: "2 repos errored or rate limited" },
    ];
    expect(estimateNext(entries, "never-seen", "dev", 3)).toBe(112.5);
    expect(estimateNext(entries, "g2-v2-cd34", "dev", 3)).toBe(112.5); // invalid parent
    expect(estimateNext(entries, "h1", "dev", 3)).toBe(112.5); // parent from another set
  });
  it("returns 0 when the set has no eligible run yet", () => {
    expect(estimateNext(dev, undefined, "holdout", 3)).toBe(0);
    expect(estimateNext([], undefined, "dev", 3)).toBe(0);
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

describe("shouldStopForBudget", () => {
  it("stops when the spend already reaches the budget, before the mutator is paid", () => {
    expect(shouldStopForBudget({ spent: 300, budgetUsd: 300 })).toBe(true);
    expect(shouldStopForBudget({ spent: 300, budgetUsd: 299.5 })).toBe(true);
    expect(shouldStopForBudget({ spent: 199.9, budgetUsd: 300 })).toBe(false);
    // No budget flag: never stops.
    expect(shouldStopForBudget({ spent: 1e6, budgetUsd: undefined })).toBe(false);
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
    // The result must be present on the remote branch, read from the bare origin itself.
    const remoteLog = run("git", ["--git-dir", origin, "log", "--oneline", "results"], os.tmpdir());
    expect(remoteLog.output).toMatch(/evolve: results 2026/);
    expect(run("git", ["--git-dir", origin, "show", "results:LOG.md"], os.tmpdir()).output).toContain("# log v2");

    // A second sync with the same log is a clean no-op: nothing to commit.
    expect(syncMirror(mirror, out, "2026")).toBe("copied (no changes to commit)");
  });

  it("refuses to commit or push when the mirror sits on main, but still copies", () => {
    const origin = fs.mkdtempSync(path.join(os.tmpdir(), "shim-mirror-origin-"));
    run("git", ["init", "-q", "--bare", "--initial-branch=main", origin], os.tmpdir());
    const mirror = fs.mkdtempSync(path.join(os.tmpdir(), "shim-mirror-git-"));
    const git = (...a: string[]) => run("git", a, mirror);
    git("init", "-q");
    git("remote", "add", "origin", origin);
    git("checkout", "-qb", "main");
    git("commit", "-q", "--allow-empty", "-m", "init");
    git("push", "-q", "origin", "main");

    const out = fs.mkdtempSync(path.join(os.tmpdir(), "shim-mirror-out3-"));
    fs.writeFileSync(path.join(out, "LOG.md"), "# log v3");
    fs.writeFileSync(path.join(out, "archive.jsonl"), "{}\n");

    const status = syncMirror(mirror, out, "2026");
    expect(status).toMatch(/mirror is on main\); not committing or pushing/);
    // Files still land in the mirror, but nothing was committed...
    expect(fs.readFileSync(path.join(mirror, "LOG.md"), "utf8")).toBe("# log v3");
    expect(git("ls-files").output).not.toContain("LOG.md");
    // ...and nothing reached the remote.
    expect(run("git", ["--git-dir", origin, "log", "--oneline", "main"], os.tmpdir()).output).not.toMatch(/evolve: results/);
    // And the mirror is its own repo root: the reason is the main branch, not the root check.
    expect(status).not.toMatch(/inside a bigger repo/);
  });
});
