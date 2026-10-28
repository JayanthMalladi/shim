/**
 * Regenerate the YC numbers from data/prs.csv: refresh each PR's state from the
 * GitHub API, print a table plus totals (opened / merged / closed / merge rate),
 * and with --write update the state, merged_at and comments columns in place.
 */
import fs from "node:fs";

export interface PrStatus {
  repo: string;
  state: "open" | "merged" | "closed";
  mergedAt: string | null;
  comments: number;
  review: "approved" | "changes_requested" | "dismissed" | "none";
  daysOpen: number;
}

export interface PrStatusOptions {
  /** Replace the state/merged_at/comments cells of matching rows in the CSV. */
  write?: boolean;
  /** fetch-like function; all HTTP goes through it so tests mock it. Default: global fetch. */
  fetchFn?: (input: string, init?: RequestInit) => Promise<Response>;
}

interface Span {
  start: number;
  end: number;
}

interface CsvRow {
  cells: string[];
  /** Byte offsets of each cell's original text, including any quoting. */
  spans: Span[];
  /** Offset just past the row's terminating newline (\n, if present); the text length when none. */
  end: number;
}

/** CSV reader: quoted fields (commas, quotes, even CRLF inside) survive round-trips. */
export function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let i = 0;
  while (i < text.length) {
    const cells: string[] = [];
    const spans: Span[] = [];
    let rowStart = i;
    for (;;) {
      const start = i;
      let value = "";
      if (text[i] === '"') {
        i++; // opening quote
        for (;;) {
          const c = text[i];
          if (c === undefined) {
            i = text.length;
            break;
          }
          if (c === '"') {
            if (text[i + 1] === '"') {
              value += '"';
              i += 2;
              continue;
            }
            i++; // closing quote
            break;
          }
          value += c;
          i++;
        }
        spans.push({ start, end: i });
      } else {
        while (i < text.length && !text[i]!.match(/[,\"\r\n]/)) i++;
        value = text.slice(start, i);
        spans.push({ start, end: i });
      }
      cells.push(value);
      if (i >= text.length) break;
      if (text[i] === ",") {
        i++;
        continue;
      }
      i++; // \n, or the \r of a \r\n pair; the newline is never part of a field
      break;
    }
    let end = i;
    if (i < text.length && text[i] === "\n") end = i + 1; // the \n half of a \r\n pair
    rows.push({ cells, spans, end });
    i = end;
  }
  return rows;
}

/** The inverse of parseCsv: only the changed cells are re-emitted; everything else, newlines included, is copied byte-for-byte. */
export function writeCsv(text: string, rows: CsvRow[], changes: Array<[number, number, string]>): string {
  changes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let out = "";
  let pos = 0;
  let i = 0;
  while (i < changes.length) {
    const rowIdx = changes[i]![0];
    const row = rows[rowIdx]!;
    out += text.slice(pos, row.spans[changes[i]![1]!]!.start);
    for (; i < changes.length && changes[i]![0] === rowIdx; i++) {
      const change = changes[i]!;
      const span = row.spans[change[1]!]!;
      out += quote(change[2]!);
      // Keep the original text up to the next changed cell, or up to the row end.
      const next = i + 1 < changes.length && changes[i + 1]![0] === rowIdx ? row.spans[changes[i + 1]![1]!]!.start : row.end;
      out += text.slice(span.end, next);
    }
    pos = row.end;
  }
  out += text.slice(pos);
  return out;
}

/** Quote only when the field needs it — the usual cells stay unquoted. */
export function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const PR_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/;

function dayStart(iso: string): number {
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]!), Number(m[2]!), Number(m[3]!));
}

function parsePrUrl(url: string): { owner: string; repo: string; num: string } | undefined {
  const match = url.match(PR_URL);
  if (!match) return undefined;
  return { owner: match[1]!, repo: match[2]!, num: match[3]! };
}

export interface PrStatusReport {
  table: PrStatus[];
  total: number;
  opened: number;
  merged: number;
  closedUnmerged: number;
  maintainerReplies: number;
  /** Merged ÷ (3+ day) opened; null when nothing qualifies. */
  mergeRate: number | null;
  rateNum: number;
  rateDenom: number;
}

/** Read the CSV, refresh every PR, print the table and totals, and (with --write) update the file. */
export async function prStatus(csvPath: string, options: PrStatusOptions = {}): Promise<PrStatusReport> {
  const text = fs.readFileSync(csvPath, "utf8");
  const report = await prStatusText(text, options, (t) => fs.writeFileSync(csvPath, t));
  printReport(report, options.write === true);
  return report;
}

function printReport(report: PrStatusReport, wrote: boolean): void {
  const w4 = Math.max(4, ...report.table.map((t) => t.repo.length));
  console.log("");
  console.log(`${"repo".padStart(w4)}  ${"state".padStart(8)} ${"days".padStart(4)} ${"comments".padStart(8)}  review`);
  for (const t of report.table)
    console.log(`${t.repo.padStart(w4)}  ${t.state.padStart(8)} ${String(t.daysOpen).padStart(4)} ${String(t.comments).padStart(8)}  ${t.review}`);
  const rate = report.mergeRate === null ? "n/a" : `${(100 * report.mergeRate).toFixed(1)}% (${report.rateNum}/${report.rateDenom}, open 3+ days)`;
  console.log("");
  console.log(
    `opened ${report.opened} · merged ${report.merged} · closed-unmerged ${report.closedUnmerged} · maintainer replies ${report.maintainerReplies} · merge rate ${rate}`,
  );
  if (wrote) console.log("CSV updated.");
}

export async function prStatusText(
  text: string,
  options: PrStatusOptions = {},
  writeBack?: (newText: string) => void,
): Promise<PrStatusReport> {
  const fetcher = options.fetchFn ?? globalThis.fetch;
  const token = process.env.GITHUB_TOKEN;
  const get = async (url: string): Promise<any> => {
    const res = await fetcher(url, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${url}`);
    return res.json();
  };

  const rows = parseCsv(text);
  const header = rows[0]?.cells.map((c) => c.trim().toLowerCase()) ?? [];
  const col = (name: string) => header.indexOf(name);
  const cRepo = col("repo");
  const cUrl = col("pr_url");
  const cOpened = col("opened_at");
  const cState = col("state");
  const cMerged = col("merged_at");
  const cComments = col("comments");
  const today0 = dayStart(new Date().toISOString());

  const table: PrStatus[] = [];
  const changes: Array<[number, number, string]> = [];
  let opened = 0,
    merged = 0,
    closedUnmerged = 0,
    maintainerReplies = 0,
    rateDenom = 0,
    rateNum = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const url = row.cells[cUrl]?.trim() ?? "";
    const ref = parsePrUrl(url);
    const repoName = row.cells[cRepo]?.trim() ?? url;
    if (!ref) {
      table.push({ repo: repoName, state: "open", mergedAt: null, comments: Number(row.cells[cComments] ?? 0) || 0, review: "none", daysOpen: -1 });
      continue;
    }
    const pr = await get(`https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.num}`);
    const reviews: any[] = await get(`https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.num}/reviews`);
    const state: PrStatus["state"] = pr.merged ? "merged" : pr.state === "open" ? "open" : "closed";
    const ts = (r: any) => {
      const t = Date.parse(r?.submitted_at ?? "");
      return Number.isNaN(t) ? -Infinity : t;
    };
    const latest = reviews.length ? reviews.reduce((a, b) => (ts(b) > ts(a) ? b : a)) : undefined;
    const entry: PrStatus = {
      repo: repoName,
      state,
      mergedAt: pr.merged ? pr.merged_at ?? "" : null,
      comments: pr.comments ?? 0,
      review: latest && ["approved", "changes_requested", "dismissed"].includes(latest.state) ? (latest.state as PrStatus["review"]) : "none",
      daysOpen: -1,
    };
    opened++;
    if (state === "merged") merged++;
    else if (state === "closed") closedUnmerged++;
    if (entry.comments > 0) maintainerReplies++;

    const openedAt = row.cells[cOpened]?.trim() ?? (pr.created_at ?? "").slice(0, 10);
    const endDay = state === "merged" && entry.mergedAt ? dayStart(entry.mergedAt) : today0;
    entry.daysOpen = Math.round((endDay - dayStart(openedAt)) / 86_400_000);
    if (entry.daysOpen >= 3) {
      rateDenom++;
      if (state === "merged") rateNum++;
    }

    if (options.write) {
      changes.push([i, cState, state]);
      changes.push([i, cMerged, entry.mergedAt ? entry.mergedAt.slice(0, 10) : ""]);
      changes.push([i, cComments, String(entry.comments)]);
    }
    table.push(entry);
  }

  if (options.write && writeBack && changes.length) writeBack(writeCsv(text, rows, changes));
  return {
    table,
    total: table.length,
    opened,
    merged,
    closedUnmerged,
    maintainerReplies,
    mergeRate: rateDenom ? rateNum / rateDenom : null,
    rateNum,
    rateDenom,
  };
}
