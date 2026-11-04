/**
 * Rank triaged targets by how likely a maintainer is to merge an outside PR. Read-only GitHub
 * calls with GITHUB_TOKEN_READONLY; never GITHUB_TOKEN or GH_TOKEN, which may be able to write.
 */
import fs from "node:fs";
import type { TriageRow } from "./triage.js";

export interface ScoredRow extends TriageRow {
  score: number;
  scoreReasons: string[];
}

const API = "https://api.github.com";
const DAY = 86_400_000;
const OUTSIDE = new Set(["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE"]);
const log = (msg: string) => console.error(`[score] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET from the GitHub API. On a 403/429, wait until x-ratelimit-reset (at most 15 minutes) and retry once. */
async function gh(path: string, token: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "shim-score-targets" },
    });
    if (res.ok) return res.json();
    if ((res.status === 403 || res.status === 429) && attempt === 0) {
      const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
      await sleep(Math.min(Math.max(reset - Date.now(), 0), 15 * 60_000));
      continue;
    }
    throw new Error(`${res.status} ${path}`);
  }
}

/** Score one repo; undefined when it's archived. */
export async function scoreRow(row: TriageRow, token: string, now = Date.now()): Promise<ScoredRow | undefined> {
  let score = 0;
  const scoreReasons: string[] = [];
  const add = (n: number, why: string) => {
    score += n;
    scoreReasons.push(`${n > 0 ? "+" : ""}${n} ${why}`);
  };
  const repo = await gh(`/repos/${row.repo}`, token);
  if (repo.archived) return undefined;
  if (now - Date.parse(repo.pushed_at) > 60 * DAY) add(-2, "no push in 60 days");
  const pulls: any[] = await gh(`/repos/${row.repo}/pulls?state=closed&per_page=50`, token);
  const outsideMerge = pulls.some((p) =>
    p.merged_at && now - Date.parse(p.merged_at) <= 60 * DAY && OUTSIDE.has(p.author_association) && p.user?.type !== "Bot");
  if (outsideMerge) add(3, "merged an outside PR in the last 60 days");
  const runs: any[] = (await gh(`/repos/${row.repo}/actions/runs?event=pull_request&per_page=30`, token)).workflow_runs ?? [];
  if (runs.length && !runs.some((r) => r.conclusion === "action_required")) add(1, "CI runs on fork PRs without approval");
  if (row.break + row.silent > 0) add(2, `${row.break + row.silent} break or silent findings`);
  return { ...row, score, scoreReasons };
}

/** Repos already in data/prs.csv, lowercased: one Shim PR per repo, ever. */
function trackedRepos(prsCsv: string): Set<string> {
  const lines = fs.readFileSync(prsCsv, "utf8").split("\n").slice(1);
  return new Set(lines.map((l) => l.split(",")[0]!.trim().toLowerCase()).filter(Boolean));
}

/** Score every row of a triage file and write it back, best first. Archived and already-tracked repos are dropped. */
export async function scoreTargets(file: string, prsCsv = "data/prs.csv"): Promise<ScoredRow[]> {
  const token = process.env.GITHUB_TOKEN_READONLY;
  if (!token) throw new Error("GITHUB_TOKEN_READONLY is not set; create a read-only token (see the T6 task file)");
  const tracked = trackedRepos(prsCsv);
  const out: ScoredRow[] = [];
  for (const row of JSON.parse(fs.readFileSync(file, "utf8")) as TriageRow[]) {
    if (tracked.has(row.repo.toLowerCase())) {
      log(`${row.repo}: dropped, already has a Shim PR`);
      continue;
    }
    try {
      const scored = await scoreRow(row, token);
      if (scored) out.push(scored);
      else log(`${row.repo}: dropped, archived`);
    } catch (e) {
      log(`${row.repo}: dropped, ${(e as Error).message}`);
    }
  }
  out.sort((a, b) => b.score - a.score);
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  return out;
}
