/**
 * The bot-PR scanner: find public Dependabot/Renovate major-bump PRs, classify their CI outcome,
 * and run Shim's static migration scan on each so we see what the new major actually breaks.
 *
 * Read-only by design (the CLAUDE.md hard rule): it clones target repos and fetches their PR refs
 * locally, and shells `gh` for search/view only. It never writes to a target repo, never pushes,
 * and never opens a PR. The `gh` runner is injectable so the tests make zero network calls.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, runCapture, targetEnv } from "./exec.js";
import { getMigration, type Migration } from "./migrations.js";
import { scanWith } from "./scan.js";

export type Source = "dependabot" | "renovate";
export type Bucket = "green" | "red" | "merged" | "no-ci" | "skip";

/** Injectable `gh` runner: `gh <args>` -> stdout (JSON text). The default shells out; tests fake it. */
export type GhRunner = (args: string[]) => string;

/** Default `gh`: read-only under the target env (no leaked tokens); stdout is returned, else throw. */
export function makeGh(): GhRunner {
  return (args) => {
    const r = runCapture("gh", args, process.cwd(), undefined, targetEnv());
    if (!r.ok) throw new Error(`gh ${args.slice(0, 4).join(" ")} failed: ${r.stdout.slice(-400)}`);
    return r.stdout;
  };
}

// ---- 1. Find ----

/** The two title searches, in the exact formats H3 reported. Grouped PRs ("Bump the ... group") match neither. */
export function searchQueries(pkg: string, from: string, to: string): Record<Source, string> {
  return {
    dependabot: `type:pr "bump ${pkg} from ${from}." "to ${to}."`,
    renovate: `type:pr "update dependency ${pkg} to v${to}"`,
  };
}

export interface SearchItem {
  repo: string; // "owner/name"
  number: number;
  url: string;
  title: string;
  state: "open" | "closed";
  createdAt: string;
  source: Source;
}

/** The "owner/name" out of a GitHub repository_url (`.../repos/o/n`) or html_url (`.../o/n/pull/N`). */
function repoOf(urls: string[]): string {
  for (const u of urls) {
    if (!u) continue;
    const m = u.match(/github\.com\/(?:repos\/)?([\w.-]+)\/([\w.-]+)/);
    if (m) return `${m[1]}/${m[2]}`;
  }
  return "unknown/unknown";
}

/** Parse one `gh api search/issues` response body into SearchItems (canned or live). */
export function parseSearchItems(raw: string, source: Source): SearchItem[] {
  const data = JSON.parse(raw);
  return (Array.isArray(data.items) ? data.items : []).map((it: any) => {
    const url: string = it.html_url ?? "";
    return {
      repo: repoOf([it.repository_url ?? "", url]),
      number: it.number,
      url,
      title: it.title ?? "",
      state: it.state === "open" ? "open" as const : "closed" as const,
      createdAt: it.created_at ?? "",
      source,
    };
  });
}

/** One PR per repo — the newest by createdAt — returned newest-first. */
export function dedupeByRepo(items: SearchItem[]): SearchItem[] {
  const byRepo = new Map<string, SearchItem>();
  for (const it of items) {
    const cur = byRepo.get(it.repo);
    if (!cur || it.createdAt > cur.createdAt) byRepo.set(it.repo, it);
  }
  return [...byRepo.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---- 3. Classify (pure, unit-tested) ----

export interface ClassifyInput {
  state: "open" | "closed";
  mergedAt: string | null;
  isArchived: boolean;
  pushedAt: string; // the repo's last push (ISO)
  checks: Array<{ conclusion: string | null; status: string }>;
}

/** A repo that has not pushed in 180 days is stale: its PR can't be judged meaningfully. */
export const STALE_MS = 180 * 86_400_000;

/**
 * Bucket a PR into exactly one of green / red / merged / no-ci / skip. Pure: no network, no clock
 * beyond the `now` argument (default Date.now()). The ordering is the partition:
 *   merged (mergedAt set) > skip (closed-unmerged, archived, stale, pending, inconclusive) >
 *   red (any check FAILURE) > no-ci (zero checks) > green (>=1 check, all COMPLETED, none failing).
 * SKIPPED/NEUTRAL conclusions are treated as passing, matching GitHub's "SUCCEEDING" rollup;
 * CANCELLED/STALE are inconclusive and go to skip.
 */
export function classify(ci: ClassifyInput, now = Date.now()): Bucket {
  if (ci.mergedAt != null) return "merged";
  if (ci.state === "closed") return "skip"; // closed, unmerged
  if (ci.isArchived) return "skip";
  const pushed = Date.parse(ci.pushedAt);
  if (Number.isFinite(pushed) && now - pushed > STALE_MS) return "skip"; // stale
  if (ci.checks.some((c) => c.status !== "COMPLETED")) return "skip"; // pending checks
  if (ci.checks.some((c) => c.conclusion === "FAILURE")) return "red";
  if (ci.checks.some((c) => c.conclusion === "CANCELLED" || c.conclusion === "STALE")) return "skip"; // inconclusive
  if (ci.checks.length === 0) return "no-ci";
  return "green";
}

// ---- 2. Enrich ----

export interface Enriched extends SearchItem {
  mergedAt: string | null;
  baseRefOid: string;
  headRefOid: string;
  mergeCommit: string;
  isArchived: boolean;
  pushedAt: string;
  stars: number;
  checks: Array<{ conclusion: string | null; status: string; name?: string }>;
}

/** The `gh pr view` fields H3 found, plus baseRefOid (the pre-bump baseline) and mergeCommit. */
const PR_FIELDS = "state,mergedAt,baseRefOid,headRefOid,headRefName,baseRefName,mergeCommit,statusCheckRollup";

/** A cached `gh` call: read `<cacheDir>/<key>` if present, else run the fetch and write it. */
function cached(cacheDir: string, key: string, fetchFn: () => string): string {
  const f = path.join(cacheDir, key);
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8");
  const out = fetchFn();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, out, "utf8");
  return out;
}

export function enrichOne(item: SearchItem, gh: GhRunner, cacheDir: string): Enriched {
  const slug = item.repo.replace("/", "__");
  const p = JSON.parse(cached(cacheDir, `pr-${slug}-${item.number}.json`,
    () => gh(["pr", "view", String(item.number), "--repo", item.repo, "--json", PR_FIELDS])));
  const r = JSON.parse(cached(cacheDir, `repo-${slug}.json`,
    () => gh(["repo", "view", item.repo, "--json", "isArchived,pushedAt,stargazerCount"])));
  return {
    ...item,
    mergedAt: p.mergedAt ?? null,
    baseRefOid: p.baseRefOid ?? "",
    headRefOid: p.headRefOid ?? "",
    mergeCommit: p.mergeCommit ?? "",
    isArchived: r.isArchived ?? false,
    pushedAt: r.pushedAt ?? "",
    stars: r.stargazerCount ?? 0,
    checks: (Array.isArray(p.statusCheckRollup) ? p.statusCheckRollup : []).map((c: any) => ({
      conclusion: c.conclusion ?? null,
      status: c.status ?? "",
      name: c.name,
    })),
  };
}

// ---- 4. Scan ----

export interface ScanRow {
  silent: number;
  break: number;
  deprecated: number;
  findings: Array<{ ruleId: string; loc: string; message: string }>;
  error?: string;
}

/**
 * The static migration scan of an already-prepared dir, tallied by severity. `baselineRef` is the
 * Part 1b gate ref: the pre-bump commit, so a package whose pin is already on the new major still
 * gets its code rules run (the bot-PR case: new pin, old code).
 */
export function scanDir(dir: string, m: Migration, baselineRef?: string): ScanRow {
  const { result } = scanWith(dir, m, baselineRef ? { baselineRef } : {});
  const counts = { silent: 0, break: 0, deprecated: 0 };
  for (const f of result.findings) counts[f.severity]++;
  return { ...counts, findings: result.findings.map((f) => ({ ruleId: f.ruleId, loc: `${f.file}:${f.line}`, message: f.message })) };
}

const noScan = (error: string): ScanRow => ({ silent: 0, break: 0, deprecated: 0, findings: [], error });
const git = (args: string[], cwd: string) => run("git", args, cwd, 5 * 60_000, targetEnv());
const repoUrl = (repo: string) => `https://github.com/${repo}`;

/** green / red: check out the PR head (new pin, old code); the PR's base commit is the baseline. */
function scanGreenRed(pr: Enriched, m: Migration): ScanRow {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-botprs-"));
  try {
    if (!git(["-c", "core.autocrlf=false", "clone", "-q", "--depth", "1", "--single-branch", repoUrl(pr.repo), dir], dir).ok)
      return noScan(`clone failed: ${pr.repo}`);
    if (!git(["fetch", "-q", "--depth", "1", "origin", `pull/${pr.number}/head`], dir).ok)
      return noScan(`fetch of PR head failed: pull/${pr.number}/head`);
    if (!git(["checkout", "-q", "FETCH_HEAD"], dir).ok)
      return noScan("checkout of PR head failed");
    if (!pr.baseRefOid || !git(["fetch", "-q", "--depth", "1", "origin", pr.baseRefOid], dir).ok)
      return noScan("fetch of base commit failed");
    return scanDir(dir, m, pr.baseRefOid);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** merged: scan the default-branch HEAD (the bump is in it); the merge commit's first parent is the baseline. */
function scanMerged(pr: Enriched, m: Migration): ScanRow {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-botprs-"));
  try {
    if (!git(["-c", "core.autocrlf=false", "clone", "-q", "--depth", "1", "--single-branch", repoUrl(pr.repo), dir], dir).ok)
      return noScan(`clone failed: ${pr.repo}`);
    if (!pr.mergeCommit) return noScan("no mergeCommit on a merged PR");
    if (!git(["fetch", "-q", "--depth", "2", "origin", pr.mergeCommit], dir).ok)
      return noScan("fetch of mergeCommit failed");
    return scanDir(dir, m, `${pr.mergeCommit}^1`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- 5. Orchestrate + write ----

export interface BotprsOpts {
  pkg: string;
  from: string; // old major, e.g. "4"
  to: string;   // new major, e.g. "5"
  migration?: Migration;
  outDir: string;
  limit?: number;
  gh?: GhRunner;
  now?: number; // ms; for the stale check (tests pin this)
}

export interface BotRow {
  repo: string;
  pr_url: string;
  source: Source;
  bucket: Bucket;
  stars: number;
  pushed_at: string;
  silent: number | "";
  break: number | "";
  deprecated: number | "";
  error: string;
}

const CSV_HEADER = ["repo", "pr_url", "source", "bucket", "stars", "pushed_at", "silent", "break", "deprecated", "error"];
const csvField = (v: string | number | ""): string => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function writeRowsCsv(rows: BotRow[], file: string): void {
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    const rec = r as unknown as Record<string, string | number | "">;
    lines.push(CSV_HEADER.map((k) => csvField(rec[k] ?? "")).join(","));
  }
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
}

const PER_PAGE = 100;

/** Page both searches (with cache) until `limit` unique repos, one PR per repo (newest). */
function find(gh: GhRunner, pkg: string, from: string, to: string, cacheDir: string, limit: number): SearchItem[] {
  const q = searchQueries(pkg, from, to);
  // The search cache key carries pkg/from/to, not just source/page: a `--out` dir shared across
  // packages must never serve one package's search bodies to another (the pr/repo keys are already
  // repo-scoped). Non-alnum chars (scoped names, dots) become `_` so the key is a safe filename.
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9.]/g, "_");
  const keyPrefix = `search-${safe(pkg)}-${safe(from)}-${safe(to)}`;
  const acc: SearchItem[] = [];
  for (const source of ["dependabot", "renovate"] as Source[]) {
    if (dedupeByRepo(acc).length >= limit) break; // enough unique repos already; don't fetch this source
    let page = 1;
    for (;;) {
      const raw = cached(cacheDir, `${keyPrefix}-${source}-p${page}.json`,
        () => gh(["api", `search/issues?q=${encodeURIComponent(q[source])}&per_page=${PER_PAGE}&page=${page}`]));
      const items = parseSearchItems(raw, source);
      acc.push(...items);
      if (dedupeByRepo(acc).length >= limit || items.length < PER_PAGE) break;
      page++;
    }
  }
  return dedupeByRepo(acc).slice(0, limit);
}

/**
 * The whole scanner: find, enrich, classify, scan (green/red/merged only), then write rows.csv and
 * one findings file per scanned PR. `skip` and `no-ci` rows are never scanned.
 */
export async function botprs(opts: BotprsOpts): Promise<BotRow[]> {
  const gh = opts.gh ?? makeGh();
  const m = opts.migration ?? getMigration();
  const limit = opts.limit ?? 50;
  const now = opts.now ?? Date.now();
  const cacheDir = path.join(opts.outDir, "cache");
  const findingsDir = path.join(opts.outDir, "findings");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(findingsDir, { recursive: true });

  const rows: BotRow[] = [];
  for (const item of find(gh, opts.pkg, opts.from, opts.to, cacheDir, limit)) {
    const pr = enrichOne(item, gh, cacheDir);
    const bucket = classify(
      { state: pr.state, mergedAt: pr.mergedAt, isArchived: pr.isArchived, pushedAt: pr.pushedAt, checks: pr.checks },
      now,
    );
    const row: BotRow = {
      repo: pr.repo, pr_url: pr.url, source: pr.source, bucket,
      stars: pr.stars, pushed_at: pr.pushedAt,
      silent: "", break: "", deprecated: "", error: "",
    };
    if (bucket === "green" || bucket === "red" || bucket === "merged") {
      const sr = bucket === "merged" ? scanMerged(pr, m) : scanGreenRed(pr, m);
      row.silent = sr.silent; row.break = sr.break; row.deprecated = sr.deprecated;
      row.error = sr.error ?? "";
      if (!sr.error) {
        fs.writeFileSync(
          path.join(findingsDir, `${pr.repo.replace("/", "__")}.json`),
          JSON.stringify({
            repo: pr.repo, pr_url: pr.url, source: pr.source, bucket,
            baselineRef: bucket === "merged" ? `${pr.mergeCommit}^1` : pr.baseRefOid,
            silent: sr.silent, break: sr.break, deprecated: sr.deprecated, findings: sr.findings,
          }, null, 2),
        );
      }
    }
    console.error(`[botprs] ${pr.repo}#${pr.number} (${pr.source}) -> ${bucket}${row.error ? `: ${row.error}` : ` [${row.silent} silent, ${row.break} break, ${row.deprecated} deprecated]`}`);
    rows.push(row);
  }
  writeRowsCsv(rows, path.join(opts.outDir, "rows.csv"));
  return rows;
}
