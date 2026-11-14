import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classify, parseSearchItems, dedupeByRepo, searchQueries, enrichOne, scanDir,
  writeRowsCsv, type GhRunner, type SearchItem,
} from "../src/botprs.js";
import { getMigration } from "../src/migrations.js";

const v6App = path.join(import.meta.dirname, "fixtures/v6-app");
const RECENT = "2026-11-01T00:00:00Z";
const NOW = Date.parse("2026-11-14T00:00:00Z");

describe("classify (pure)", () => {
  const checks = (n: number) => Array.from({ length: n }, () => ({ conclusion: "SUCCESS", status: "COMPLETED" }));
  const base = { state: "open" as const, mergedAt: null, isArchived: false, pushedAt: RECENT, checks: checks(2) };

  it("green: open, >=1 check, all COMPLETED, none failing", () => {
    expect(classify({ ...base, checks: checks(3) }, NOW)).toBe("green");
  });
  it("red: open, a FAILURE conclusion", () => {
    const c = checks(3); c[1]!.conclusion = "FAILURE";
    expect(classify({ ...base, checks: c }, NOW)).toBe("red");
  });
  it("merged: mergedAt is set (state is 'closed')", () => {
    expect(classify({ ...base, state: "closed", mergedAt: RECENT }, NOW)).toBe("merged");
  });
  it("no-ci: open with zero checks", () => {
    expect(classify({ ...base, checks: [] }, NOW)).toBe("no-ci");
  });
  it("skip: closed and unmerged", () => {
    expect(classify({ ...base, state: "closed" }, NOW)).toBe("skip");
  });
  it("skip: pending checks (any non-COMPLETED status)", () => {
    const c = checks(2); c[0]!.status = "IN_PROGRESS";
    expect(classify({ ...base, checks: c }, NOW)).toBe("skip");
  });
  it("skip: an archive", () => {
    expect(classify({ ...base, isArchived: true }, NOW)).toBe("skip");
  });
  it("skip: stale (no push in >180 days)", () => {
    expect(classify({ ...base, pushedAt: "2025-09-01T00:00:00Z" }, NOW)).toBe("skip");
  });
  it("not stale: a push within 180 days stays classifiable", () => {
    expect(classify({ ...base, pushedAt: "2026-06-01T00:00:00Z" }, NOW)).toBe("green");
  });
  it("SKIPPED and NEUTRAL conclusions count as passing (GitHub SUCCEEDING rollup)", () => {
    const c = checks(2); c[0]!.conclusion = "SKIPPED"; c[1]!.conclusion = "NEUTRAL";
    expect(classify({ ...base, checks: c }, NOW)).toBe("green");
  });
  it("CANCELLED or STALE conclusion is inconclusive -> skip", () => {
    for (const concl of ["CANCELLED", "STALE"] as const) {
      const c = checks(2); c[0]!.conclusion = concl;
      expect(classify({ ...base, checks: c }, NOW)).toBe("skip");
    }
  });
  it("red beats skip-inconclusive: a FAILURE wins over a CANCELLED in the same PR", () => {
    const c = checks(2); c[0]!.conclusion = "CANCELLED"; c[1]!.conclusion = "FAILURE";
    expect(classify({ ...base, checks: c }, NOW)).toBe("red");
  });
  it("merged beats an archive (a merged PR is reported even if the repo later archived)", () => {
    expect(classify({ ...base, state: "closed", mergedAt: RECENT, isArchived: true }, NOW)).toBe("merged");
  });
});

describe("search parsing (canned, no network)", () => {
  const search = JSON.stringify({
    items: [
      { number: 5, html_url: "https://github.com/acme/alpha/pull/5", repository_url: "https://api.github.com/repos/acme/alpha", title: "Bump ai from 6.0.0 to 7.0.0", state: "open", created_at: "2026-11-01T00:00:00Z" },
      { number: 9, html_url: "https://github.com/acme/alpha/pull/9", repository_url: "https://api.github.com/repos/acme/alpha", title: "update dependency ai to v7", state: "closed", created_at: "2026-11-03T00:00:00Z" },
      { number: 2, html_url: "https://github.com/beta/bravo/pull/2", repository_url: "https://api.github.com/repos/beta/bravo", title: "Bump ai from 6.0.0 to 7.0.0", state: "open", created_at: "2026-11-02T00:00:00Z" },
    ],
  });

  it("parses repo, number, state, title, source from the API body", () => {
    const items = parseSearchItems(search, "dependabot");
    expect(items.map((i) => i.repo)).toEqual(["acme/alpha", "acme/alpha", "beta/bravo"]);
    expect(items[0]!.number).toBe(5);
    expect(items[0]!.source).toBe("dependabot");
    expect(items[1]!.state).toBe("closed");
  });
  it("keeps one PR per repo — the newest by created_at", () => {
    const items = parseSearchItems(search, "dependabot");
    const one = dedupeByRepo(items);
    expect(one.map((i) => `${i.repo}#${i.number}`).sort()).toEqual(["acme/alpha#9", "beta/bravo#2"]);
    expect(dedupeByRepo(items)[0]!.repo).toBe("acme/alpha"); // newest-first: #9 (2026-11-03)
  });
  it("search queries match H3's exact bot phrasings", () => {
    expect(searchQueries("ai", "6", "7")).toEqual({
      dependabot: 'type:pr "bump ai from 6." "to 7."',
      renovate: 'type:pr "update dependency ai to v7"',
    });
  });
});

describe("enrichOne (inject the gh runner: no network)", () => {
  /** A gh runner that answers search/pr/repo from canned JSON and records every fetch it actually makes. */
  function fakeGh(fetchLog: string[], pr: Record<string, any>, repo: Record<string, any>): GhRunner {
    return (args) => {
      const j = (o: any) => JSON.stringify(o);
      if (args[0] === "api") { fetchLog.push("search"); return j({ items: [] }); }
      if (args[0] === "pr") { fetchLog.push(`pr:${args[2]}`); return j(pr); }
      if (args[0] === "repo") { fetchLog.push(`repo:${args[1]}`); return j(repo); }
      throw new Error(`unexpected gh ${args.join(" ")}`);
    };
  }
  const item: SearchItem = { repo: "acme/alpha", number: 5, url: "https://github.com/acme/alpha/pull/5", title: "Bump ai from 6.0.0 to 7.0.0", state: "open", createdAt: RECENT, source: "dependabot" };
  const prJson = { state: "OPEN", mergedAt: null, baseRefOid: "base123", headRefOid: "head456", mergeCommit: null, statusCheckRollup: [{ conclusion: "SUCCESS", status: "COMPLETED", name: "CI" }] };
  const repoJson = { isArchived: false, pushedAt: RECENT, stargazerCount: 42 };

  it("joins the PR fields with the repo fields", () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "shim-bp-cache-"));
    const log: string[] = [];
    const e = enrichOne(item, fakeGh(log, prJson, repoJson), cache);
    expect({ repo: e.repo, n: e.number, base: e.baseRefOid, head: e.headRefOid, stars: e.stars, archived: e.isArchived, checks: e.checks.length }).toEqual(
      { repo: "acme/alpha", n: 5, base: "base123", head: "head456", stars: 42, archived: false, checks: 1 });
  });
  it("caches each response: a second call makes no further gh fetches", () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "shim-bp-cache-"));
    const log: string[] = [];
    const gh = fakeGh(log, prJson, repoJson);
    enrichOne(item, gh, cache);
    const after1 = log.length;
    expect(after1).toBeGreaterThan(0);
    enrichOne(item, gh, cache);
    expect(log.length, "the second enrich must be served from the cache").toBe(after1);
  });
});

describe("scanDir (local fixture, no network, no git)", () => {
  it("a bumped-pin fixture returns silent findings", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-bp-scan-"));
    fs.cpSync(v6App, dir, { recursive: true });
    // The bot-PR case: the pin is already on the new major.
    const pj = path.join(dir, "package.json");
    const j = JSON.parse(fs.readFileSync(pj, "utf8"));
    j.dependencies.ai = "^7.0.0";
    fs.writeFileSync(pj, JSON.stringify(j, null, 2));

    const row = scanDir(dir, getMigration("ai-sdk-v7"));
    expect(row.silent, JSON.stringify(row, null, 2)).toBeGreaterThan(0);
    expect(row.findings[0]!.loc).toMatch(/.+:\d+$/); // file:line
    expect(row.findings[0]!.ruleId).toBeTruthy();
    expect(row.findings[0]!.message).toBeTruthy();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 60_000); // a ts-morph scan of the fixture is heavy; the global 5s cap is for fast tests
});

describe("writeRowsCsv", () => {
  it("writes the header and one row per PR, quoting fields that need it", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "shim-bp-csv-")), "rows.csv");
    writeRowsCsv([
      { repo: "acme/alpha", pr_url: "https://github.com/acme/alpha/pull/5", source: "dependabot", bucket: "green", stars: 42, pushed_at: RECENT, silent: 3, break: 1, deprecated: 0, error: "" },
      { repo: "beta,inc/bravo", pr_url: "https://github.com/beta,inc/bravo/pull/2", source: "renovate", bucket: "skip", stars: 0, pushed_at: RECENT, silent: "", break: "", deprecated: "", error: "clone failed" },
    ], file);
    const lines = fs.readFileSync(file, "utf8").trimEnd().split("\n");
    expect(lines[0]).toBe("repo,pr_url,source,bucket,stars,pushed_at,silent,break,deprecated,error");
    expect(lines[1]).toBe(`acme/alpha,https://github.com/acme/alpha/pull/5,dependabot,green,42,${RECENT},3,1,0,`);
    // Both the repo (owner "beta,inc") and the pr_url carry a comma -> both are double-quoted.
    expect(lines[2]).toBe(`"beta,inc/bravo","https://github.com/beta,inc/bravo/pull/2",renovate,skip,0,${RECENT},,,,clone failed`);
  });
});
