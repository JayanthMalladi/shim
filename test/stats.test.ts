import { describe, expect, it } from "vitest";
import { buildStats, listPrs } from "../src/stats.js";

const csv = [
  "repo,stars,last_commit,pr_url,opened_at,state,merged_at,comments,notes",
  'b/two,,,https://github.com/b/two/pull/2,2026-10-28,open,,0,"note, with comma"',
  "a/one,,,https://github.com/a/one/pull/1,2026-10-27,merged,2026-10-30,1,",
  "c/three,,,https://github.com/c/three/issues/3,2026-10-29,open,,0,",
].join("\n");

describe("listPrs", () => {
  it("lists only pull requests, oldest first, with merged state", () => {
    expect(listPrs(csv)).toEqual([
      { repo: "a/one", url: "https://github.com/a/one/pull/1", state: "merged", openedAt: "2026-10-27" },
      { repo: "b/two", url: "https://github.com/b/two/pull/2", state: "open", openedAt: "2026-10-28" },
    ]);
  });

  it("is included in buildStats", () => {
    const s = buildStats(csv, Date.parse("2026-11-02"));
    expect(s.list).toHaveLength(2);
    expect(s.prs.merged).toBe(1);
  });
});
