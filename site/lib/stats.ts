// The site's live numbers, generated from data/prs.csv by `shim stats`
// (src/stats.ts). A cron regenerates stats.json and pushes it; this static
// build reads it at compile time, so the page's counts track the real PRs.
//
// The proof block is a fixed historical story; prs.* is the live block.

export interface PrStats {
  total: number;
  open: number;
  merged: number;
  replied: number;
  mergeRate: string;
  mergeRate3d: string;
}

export interface Stats {
  asOf: string;
  prs: PrStats;
  proof: {
    headline: string;
    stats: Array<[string, string]>;
  };
}

import raw from "./stats.json";

// The generated JSON deserializes its [label, value] pairs to string[][], so
// cast to the tuple shape. A missing/empty file falls back to an empty live block.
export const stats: Stats =
  raw && (raw as Stats).prs
    ? (raw as unknown as Stats)
    : {
        asOf: new Date().toISOString(),
        prs: { total: 0, open: 0, merged: 0, replied: 0, mergeRate: "n/a", mergeRate3d: "n/a" },
        proof: { headline: "0", stats: [] },
      };

export const prs = stats.prs;
export const proof = stats.proof;
