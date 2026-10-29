import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The site's single source of truth for its numbers. `shim stats` regenerates
 * site/lib/stats.json from data/prs.csv (the PR ledger) plus a small set of
 * historical proof facts, so a static build shows live counts instead of a
 * baked-in snapshot. A cron commits the regenerated JSON; Vercel redeploys.
 *
 * The live block (prs.*) is re-derived every run. The proof block is historical
 * facts from the Oct 27-28 run logs that we do NOT re-derive — they are the
 * story of the first overnight runs, fixed once and only re-worded by hand.
 */

export interface PrStats {
  total: number;
  open: number;
  merged: number;
  /** PRs with at least one maintainer comment or review (replies are a first-class KPI). */
  replied: number;
  mergeRate: string;
  /** merged ÷ opened, counting only PRs open for at least 3 days (the defensible YC number). */
  mergeRate3d: string;
}

export interface Stats {
  /** When this file was regenerated. */
  asOf: string;
  prs: PrStats;
  proof: {
    headline: string;
    stats: Array<[string, string]>;
  };
}

/** Historical facts from the first overnight runs (not re-derived). Edit only when the story changes. */
const PROOF: Stats["proof"] = {
  headline: "5",
  stats: [
    ["repos attempted, night one", "23"],
    ["pr-ready, night one", "11 · 48%"],
    ["pr-ready, two nights", "16"],
    ["agent cost per repo", "$0.06–$5.63"],
    ["v6 packages self-migrated, ~6 wks", "12 / 45"],
  ],
};

/** Minimal quoted-CSV reader (handles the notes column's embedded commas/quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = text.trimEnd().split("\n").filter(Boolean);
  const header = rows[0]!.split(",").map((h) => h.trim());
  return rows.slice(1).map((line) => {
    const cells: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ",") {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(cells.map((c, i) => [header[i]!, c.trim()]));
  });
}

const DAY = 86_400_000;

/** Live PR counts from the ledger. `now` is injectable for tests. */
export function computePrStats(csv: string, now = Date.now()): PrStats {
  const rows = parseCsv(csv).filter((r) => r.pr_url?.includes("/pull/"));
  const openedMs = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? now : t;
  };
  let open = 0,
    merged = 0,
    replied = 0;
  let merged3d = 0,
    eligible3d = 0;
  for (const r of rows) {
    const isMerged = r.state === "merged" || !!r.merged_at;
    if (isMerged) merged++;
    else if (r.state === "open") open++;
    if (Number(r.comments || 0) > 0) replied++;
    const ageDays = (now - openedMs(r.opened_at ?? "")) / DAY;
    if (ageDays >= 3) {
      eligible3d++;
      if (isMerged) merged3d++;
    }
  }
  const total = rows.length;
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "n/a");
  return {
    total,
    open,
    merged,
    replied,
    mergeRate: pct(merged, total),
    mergeRate3d: eligible3d ? `${merged3d}/${eligible3d} (${pct(merged3d, eligible3d)})` : "n/a (<3 days open)",
  };
}

/** Build the full stats object (live prs + fixed proof). */
export function buildStats(prsCsv: string, now = Date.now()): Stats {
  return { asOf: new Date(now).toISOString(), prs: computePrStats(prsCsv, now), proof: PROOF };
}

/**
 * Regenerate site/lib/stats.json from the PR ledger and return the written Stats.
 * `prCsv` and `out` default to the repo-standard paths so the CLI call is one-liner.
 */
export function writeStats(opts?: { prCsv?: string; out?: string; now?: number }): Stats {
  // This module lives in src/; the repo root is one level up.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const prCsv = opts?.prCsv ?? path.join(root, "data", "prs.csv");
  const out = opts?.out ?? path.join(root, "site", "lib", "stats.json");
  const stats = buildStats(fs.readFileSync(prCsv, "utf8"), opts?.now);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(stats, null, 2) + "\n");
  return stats;
}
