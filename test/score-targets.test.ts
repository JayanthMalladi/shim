import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scoreRow, scoreTargets } from "../src/score-targets.js";
import type { TriageRow } from "../src/triage.js";

const NOW = Date.parse("2026-11-03T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const row = (over: Partial<TriageRow> = {}): TriageRow => ({
  name: "pkg", version: "1.0.0", aiRange: "^3.22.0", repo: "acme/app", published: daysAgo(5),
  break: 0, silent: 0, deprecated: 0, aiPackages: 1, ...over,
});

/** A GitHub API double: repo, pulls and runs responses, plus every URL and auth header it saw. */
function stubGitHub(over: { repo?: object; pulls?: object[]; runs?: object[]; status?: number[] } = {}) {
  const seen: Array<{ url: string; auth: string | null }> = [];
  const statuses = [...(over.status ?? [])];
  vi.stubGlobal("fetch", async (url: string, init: { headers: Record<string, string> }) => {
    seen.push({ url, auth: init.headers.authorization ?? null });
    const status = statuses.shift() ?? 200;
    const body = url.includes("/pulls") ? over.pulls ?? []
      : url.includes("/actions/runs") ? { workflow_runs: over.runs ?? [] }
      : { archived: false, pushed_at: daysAgo(1), ...over.repo };
    return { ok: status === 200, status, headers: new Headers({ "x-ratelimit-reset": String(Math.floor(NOW / 1000)) }), json: async () => body };
  });
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("scoreRow", () => {
  it("scores an active repo with no signals as 0", async () => {
    stubGitHub();
    expect(await scoreRow(row(), "t", NOW)).toMatchObject({ score: 0, scoreReasons: [] });
  });
  it("drops an archived repo", async () => {
    stubGitHub({ repo: { archived: true } });
    expect(await scoreRow(row(), "t", NOW)).toBeUndefined();
  });
  it("-2 when the last push is older than 60 days", async () => {
    stubGitHub({ repo: { pushed_at: daysAgo(61) } });
    expect(await scoreRow(row(), "t", NOW)).toMatchObject({ score: -2, scoreReasons: ["-2 no push in 60 days"] });
  });
  it("+3 for an outside PR merged in the last 60 days", async () => {
    stubGitHub({ pulls: [{ merged_at: daysAgo(10), author_association: "CONTRIBUTOR", user: { type: "User" } }] });
    expect(await scoreRow(row(), "t", NOW)).toMatchObject({ score: 3, scoreReasons: ["+3 merged an outside PR in the last 60 days"] });
  });
  it.each([
    ["a member's PR", { merged_at: daysAgo(10), author_association: "MEMBER", user: { type: "User" } }],
    ["a bot's PR", { merged_at: daysAgo(10), author_association: "CONTRIBUTOR", user: { type: "Bot" } }],
    ["an old merge", { merged_at: daysAgo(61), author_association: "CONTRIBUTOR", user: { type: "User" } }],
    ["a closed, unmerged PR", { merged_at: null, author_association: "NONE", user: { type: "User" } }],
  ])("no +3 for %s", async (_, pull) => {
    stubGitHub({ pulls: [pull] });
    expect((await scoreRow(row(), "t", NOW))!.score).toBe(0);
  });
  it("+1 when fork PR runs never waited for approval", async () => {
    stubGitHub({ runs: [{ conclusion: "success" }, { conclusion: "failure" }] });
    expect(await scoreRow(row(), "t", NOW)).toMatchObject({ score: 1, scoreReasons: ["+1 CI runs on fork PRs without approval"] });
  });
  it("no +1 when a run needed approval, or there are no runs", async () => {
    stubGitHub({ runs: [{ conclusion: "success" }, { conclusion: "action_required" }] });
    expect((await scoreRow(row(), "t", NOW))!.score).toBe(0);
    stubGitHub({ runs: [] });
    expect((await scoreRow(row(), "t", NOW))!.score).toBe(0);
  });
  it("+2 when triage found break or silent findings", async () => {
    stubGitHub();
    expect(await scoreRow(row({ silent: 2, break: 1 }), "t", NOW)).toMatchObject({ score: 2, scoreReasons: ["+2 3 break or silent findings"] });
    expect((await scoreRow(row({ deprecated: 4 }), "t", NOW))!.score).toBe(0);
  });
  it("waits for the rate-limit reset and retries once", async () => {
    const seen = stubGitHub({ status: [429] });
    expect((await scoreRow(row(), "t", NOW))!.score).toBe(0);
    expect(seen[0]!.url).toBe(seen[1]!.url);
  });
  it("gives up after a second rate-limit answer", async () => {
    stubGitHub({ status: [403, 403] });
    await expect(scoreRow(row(), "t", NOW)).rejects.toThrow("403");
  });
});

describe("scoreTargets", () => {
  const files = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "score-"));
    const targets = path.join(dir, "targets.json");
    const prs = path.join(dir, "prs.csv");
    fs.writeFileSync(targets, JSON.stringify([row({ repo: "acme/low" }), row({ repo: "acme/high", silent: 1 }), row({ repo: "Tracked/Repo" })]));
    fs.writeFileSync(prs, "repo,stars,last_commit,pr_url\ntracked/repo,,,https://github.com/tracked/repo/pull/1\n");
    return { targets, prs };
  };

  it("refuses to run without GITHUB_TOKEN_READONLY, even when GITHUB_TOKEN is set", async () => {
    vi.stubEnv("GITHUB_TOKEN_READONLY", "");
    vi.stubEnv("GITHUB_TOKEN", "write-token");
    const seen = stubGitHub();
    const { targets, prs } = files();
    await expect(scoreTargets(targets, prs)).rejects.toThrow("GITHUB_TOKEN_READONLY");
    expect(seen).toEqual([]);
  });

  it("sends only the read-only token, drops tracked repos, and writes the file back best first", async () => {
    vi.stubEnv("GITHUB_TOKEN_READONLY", "ro-token");
    vi.stubEnv("GITHUB_TOKEN", "write-token");
    const seen = stubGitHub();
    const { targets, prs } = files();
    const out = await scoreTargets(targets, prs);
    expect(out.map((r) => [r.repo, r.score])).toEqual([["acme/high", 2], ["acme/low", 0]]);
    expect(JSON.parse(fs.readFileSync(targets, "utf8")).map((r: TriageRow) => r.repo)).toEqual(["acme/high", "acme/low"]);
    expect(new Set(seen.map((s) => s.auth))).toEqual(new Set(["Bearer ro-token"]));
    expect(seen.some((s) => s.url.includes("Tracked/Repo"))).toBe(false);
  });
});
