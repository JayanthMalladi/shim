// The site's live numbers, generated from data/prs.csv by `shim stats`
// (src/stats.ts). A cron regenerates stats.json and pushes it; this static
// build reads it at compile time, so the page's counts track the real PRs.
//
// The proof block is a fixed historical story; prs.* and list are live.

export interface PrStats {
  total: number;
  open: number;
  merged: number;
  replied: number;
  mergeRate: string;
  mergeRate3d: string;
}

export interface PrRow {
  repo: string;
  url: string;
  state: "open" | "merged" | "closed";
  openedAt: string;
}

export interface Stats {
  asOf: string;
  prs: PrStats;
  list: PrRow[];
  proof: {
    headline: string;
    stats: Array<[string, string]>;
  };
}

import raw from "./stats.json";

// The generated JSON deserializes its [label, value] pairs to string[][], so
// cast to the tuple shape. A missing/empty file falls back to an empty live block.
const parsed = raw as unknown as Partial<Stats>;
export const stats: Stats = {
  asOf: parsed.asOf ?? new Date().toISOString(),
  prs: parsed.prs ?? { total: 0, open: 0, merged: 0, replied: 0, mergeRate: "n/a", mergeRate3d: "n/a" },
  list: parsed.list ?? [],
  proof: parsed.proof ?? { headline: "0", stats: [] },
};

export const prs = stats.prs;
export const prList = stats.list;
export const proof = stats.proof;

/** Look up a fixed proof fact by its label prefix, e.g. proofValue("agent cost"). */
export function proofValue(labelStart: string): string | undefined {
  return proof.stats.find(([k]) => k.startsWith(labelStart))?.[1];
}
