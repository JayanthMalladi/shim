import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseCsv, prStatus, prStatusText } from "../src/pr-status.js";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

// Four live PRs: open (10 days, changes requested, 4 comments), merged late (5 days, approved,
// 2 comments), merged fast (1 day, excluded from the 3+ day rate), closed-unmerged (approved
// but never merged). The last row has no pr_url: skipped and must survive byte-for-byte.
function fixture() {
  const d = { open10: daysAgo(10), merged5: daysAgo(5), fast1: daysAgo(1), closed8: daysAgo(8) };
  const prs = {
    "requestyai/ai-sdk-requesty:66": {
      body: { state: "open", merged: false, merge_commit_sha: null, comments: 6, user: { login: "JayanthMalladi", type: "User" } },
      reviews: [{ state: "changes_requested", user: { login: "maint", type: "User" }, submitted_at: new Date(Date.now() - 3_600_000).toISOString() }],
      // 4 maintainer comments; the author's own reply and a bot don't count.
      comments: [
        ...Array.from({ length: 4 }, () => ({ user: { login: "maint", type: "User" } })),
        { user: { login: "JayanthMalladi", type: "User" } },
        { user: { login: "changeset-bot[bot]", type: "Bot" } },
      ],
    },
    "vercel-ai/quick:10": {
      body: { state: "closed", merged: true, merge_commit_sha: "abc123", comments: 2, merged_at: `${d.merged5}T00:00:00Z` },
      comments: [{ user: { login: "a", type: "User" } }, { user: { login: "b", type: "User" } }],
      reviews: [{ state: "approved", submitted_at: `${d.merged5}T00:00:00Z` }],
    },
    "vercel-ai/quick:7": {
      body: { state: "closed", merged: true, merge_commit_sha: "def456", comments: 0, merged_at: `${d.fast1}T00:00:00Z` },
      reviews: [],
    },
    "someorg/stalled:3": {
      body: { state: "closed", merged: false, merge_commit_sha: null, comments: 3 },
      reviews: [{ state: "approved", user: { login: "Copilot", type: "Bot" }, submitted_at: `${d.closed8}T00:00:00Z` }],
      // Only bots commented (as on ChainFuse#1136): not a maintainer reply.
      comments: [{ user: { login: "socket-security[bot]", type: "Bot" } }, { user: { login: "changeset-bot[bot]", type: "Bot" } }, { user: { login: "copilot-pull-request-reviewer[bot]", type: "Bot" } }],
    },
  };
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const m = url.match(/repos\/([^/]+)\/([^/]+)\/(pulls|issues)\/(\d+)(\/reviews|\/comments)?(\?.*)?$/)!;
    const fixture1 = (prs as Record<string, any>)[`${m[1]}/${m[2]}:${m[4]}`];
    if (!fixture1) throw new Error(`unexpected url ${url}`);
    const body = m[5] === "/reviews" ? fixture1.reviews : m[5] === "/comments" ? fixture1.comments ?? [] : fixture1.body;
    return { ok: true, status: 200, json: async () => body, _init: init } as unknown as Response;
  });
  const csv = [
    "repo,stars,last_commit,pr_url,opened_at,state,merged_at,comments,notes",
    `requestyai/ai-sdk-requesty,1200,${d.open10},https://github.com/requestyai/ai-sdk-requesty/pull/66,${d.open10},open,,,"first PR, ""shim"" note, round 2"`,
    `vercel-ai/quick,50,,https://github.com/vercel-ai/quick/pull/10,${daysAgo(20)},open,,,"quick start"`,
    `vercel-ai/quick,50,,https://github.com/vercel-ai/quick/pull/7,${daysAgo(2)},open,,,"fast"`,
    `someorg/stalled,3,,https://github.com/someorg/stalled/pull/3,${d.closed8},open,,,"stalled"`,
    `local/none,,,,${d.open10},open,,,"no url row"`,
  ].join("\r\n");
  return { fetchFn, csv, d };
}

describe("prStatusText", () => {
  it("refreshes each PR and reports the totals", async () => {
    const { fetchFn, csv } = fixture();
    const report = await prStatusText(csv, { fetchFn });
    expect(report.total).toBe(5);
    expect(report.opened).toBe(4);
    expect(report.merged).toBe(2);
    expect(report.closedUnmerged).toBe(1);
    expect(report.maintainerReplies).toBe(2);
    expect(report.table[0]).toMatchObject({ repo: "requestyai/ai-sdk-requesty", state: "open", comments: 4, review: "changes_requested" });
    expect(report.table[1]).toMatchObject({ repo: "vercel-ai/quick", state: "merged", review: "approved" });
    // An approval never counts as a merge: the closed PR with an approved review is closed-unmerged.
    expect(report.table[3]).toMatchObject({ repo: "someorg/stalled", state: "closed", review: "approved", comments: 0 });
    expect(report.table[4]).toMatchObject({ repo: "local/none", daysOpen: -1 });
  });

  it("excludes a PR merged within 3 days from the merge-rate denominator", async () => {
    const { fetchFn, csv } = fixture();
    const report = await prStatusText(csv, { fetchFn });
    // Four opened, three ran 3+ days: the 1-day merge is out of the denominator. One of three merged.
    expect(report.table[2]).toMatchObject({ state: "merged", daysOpen: 1 });
    expect(report.rateNum).toBe(1);
    expect(report.rateDenom).toBe(3);
    expect(report.mergeRate).toBeCloseTo(1 / 3);

    // With the only 3+ day PR still open, a recent merge alone makes the rate 0%.
    const fastCsv = [
      "repo,stars,last_commit,pr_url,opened_at,state,merged_at,comments,notes",
      `vercel-ai/quick,50,,https://github.com/vercel-ai/quick/pull/7,${daysAgo(2)},open,,,`,
      `requestyai/ai-sdk-requesty,1200,,https://github.com/requestyai/ai-sdk-requesty/pull/66,${daysAgo(10)},open,,,`,
    ].join("\r\n");
    const r2 = await prStatusText(fastCsv, { fetchFn });
    expect(r2.merged).toBe(1);
    expect(r2.mergeRate).toBe(0);
  });

  it("writes state/merged_at/comments back, leaving every other cell byte-for-byte", async () => {
    const { fetchFn, csv, d } = fixture();
    let written = "";
    await prStatusText(csv, { fetchFn, write: true }, (t) => (written = t));

    const rows = parseCsv(written);
    const cell = (row: number, name: string) => rows[row]?.cells[rows[0]!.cells.indexOf(name)];
    expect(cell(1, "state")).toBe("open");
    expect(cell(1, "comments")).toBe("4");
    expect(cell(2, "state")).toBe("merged");
    expect(cell(2, "merged_at")).toBe(d.merged5);
    expect(cell(2, "comments")).toBe("2");
    expect(cell(3, "state")).toBe("merged");
    expect(cell(3, "merged_at")).toBe(d.fast1);
    expect(cell(4, "state")).toBe("closed");
    // The unqueried row is byte-identical, including its quoted notes.
    expect(written).toContain(`local/none,,,,${d.open10},open,,,"no url row"`);
    expect(written).toContain('"first PR, ""shim"" note, round 2"');
    expect(cell(1, "notes")).toBe('first PR, "shim" note, round 2');
    // Line-level diff: only the four queried rows changed, the no-url row kept its index.
    const diffLines = csv.split("\r\n").filter((line, i) => line !== written.split("\r\n")[i]);
    expect(diffLines.length).toBe(4);
  });
});

describe("prStatus (printed)", () => {
  it("prints the table and the totals line", async () => {
    const { fetchFn, csv } = fixture();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-pr-status-"));
    const file = path.join(dir, "prs.csv");
    fs.writeFileSync(file, csv);
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => lines.push(a.join(" ")));
    try {
      await prStatus(file, { fetchFn });
      const out = lines.join("\n");
      expect(out).toContain("requestyai/ai-sdk-requesty");
      expect(out).toContain("opened 4");
      expect(out).toContain("merged 2");
      expect(out).toContain("closed-unmerged 1");
      expect(out).toContain("maintainer replies 2");
      expect(out).toContain("33.3%");
    } finally {
      spy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("auth", () => {
  it("sends GITHUB_TOKEN as a Bearer header when set, no headers when unset", async () => {
    const { fetchFn, csv } = fixture();
    process.env.GITHUB_TOKEN = "shim-test-token";
    await prStatusText(csv, { fetchFn });
    const withAuth = fetchFn.mock.calls as unknown as Array<[string, RequestInit?]>;
    expect(withAuth.length).toBe(12);
    expect(withAuth.every(([, init]) => (init?.headers as Record<string, string>)?.authorization === "Bearer shim-test-token")).toBe(true);

    delete process.env.GITHUB_TOKEN;
    const { fetchFn: f2, csv: csv2 } = fixture();
    await prStatusText(csv2, { fetchFn: f2 });
    const plain = f2.mock.calls as unknown as Array<[string, RequestInit?]>;
    expect(plain.every(([, init]) => init === undefined)).toBe(true);
  });
});
