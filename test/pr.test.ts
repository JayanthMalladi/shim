import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { agentEnv, run } from "../src/exec.js";
import {
  prOpen,
  prRecord,
  appendCsvRow,
  csvHasRow,
  csvQuote,
  recordedHead,
  draftRepo,
  compareUrl,
  PR_BRANCH,
} from "../src/pr.js";

const TMP: string[] = [];
const tmp = (p = "shim-pr-") => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), p));
  TMP.push(d);
  return d;
};
afterEach(() => {
  for (const d of TMP.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

// git must find no global/user config (point HOME and USERPROFILE at an empty dir); the identity
// comes from environment vars, which is what prOpen inherits through opts.env.
const gitEnv: NodeJS.ProcessEnv = {
  ...agentEnv(),
  HOME: os.tmpdir(),
  USERPROFILE: os.tmpdir(),
  GIT_AUTHOR_NAME: "Shim Test", GIT_AUTHOR_EMAIL: "shim@test.local",
  GIT_COMMITTER_NAME: "Shim Test", GIT_COMMITTER_EMAIL: "shim@test.local",
};
const git = (dir: string, ...args: string[]) => run("git", args, dir, 5 * 60_000, gitEnv);
const onBare = (bare: string, ...args: string[]) => run("git", ["--git-dir", bare, ...args], os.tmpdir(), 5 * 60_000, gitEnv);

function bareRepo(name: string): string {
  const d = path.join(tmp("shim-pr-repos-"), name);
  fs.mkdirSync(d, { recursive: true });
  expect(git(os.tmpdir(), "init", "-q", "--bare", "--initial-branch=main", d).ok).toBe(true);
  return d;
}

/** Create <branch> on the bare repo with the given files; returns its HEAD sha. */
function seed(bare: string, branch: string, files: Record<string, string>): string {
  const c = tmp("shim-pr-seed-");
  expect(git(c, "clone", "-q", bare, c + "-c").ok).toBe(true);
  const w = c + "-c";
  git(w, "checkout", "-qB", branch);
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.join(w, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(w, f), text);
  }
  git(w, "add", "-A");
  git(w, "commit", "-q", "-m", "seed");
  expect(git(w, "push", "-q", "origin", branch).ok).toBe(true);
  return git(w, "rev-parse", "HEAD").output.trim();
}

/**
 * A draft dir <dir>/<owner>__<repo>: status.txt with the recorded HEAD ("" = none), pr.md, and a
 * changes.patch that adds index.js.
 */
function makeDraft(dir: string, repo: string, recordedSha: string): string {
  const d = path.join(dir, repo.replace("/", "__"));
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "changes.patch"), [
    "diff --git a/index.js b/index.js",
    "new file mode 100644",
    "index 0000000..e69de29",
    "--- /dev/null",
    "+++ b/index.js",
    "@@ -0,0 +1,2 @@",
    "+let x = 1;",
    "+console.log(x);",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(d, "status.txt"), "ready\n" + (recordedSha ? `HEAD: ${recordedSha}\n` : ""));
  fs.writeFileSync(path.join(d, "pr.md"), "### Summary\nUpgrade to AI SDK 7\n");
  return d;
}

/** Upstream and fork bare repos with the same main history. */
function setup(forkOwner = "acct", repo = "acct/demo") {
  const upstream = bareRepo("upstream.git");
  const fork = bareRepo("fork.git");
  seed(fork, "main", { "package.json": '{\n  "name": "demo"\n}\n' });
  seed(upstream, "main", { "package.json": '{\n  "name": "demo"\n}\n' });
  return { upstream, fork, forkOwner, repo };
}

describe("prOpen happy path", () => {
  it("applies the patch to shim/ai-sdk-7 on the fork and pushes it", () => {
    const { upstream, fork, forkOwner, repo } = setup();
    const sha = onBare(upstream, "rev-parse", "main").output.trim();
    const draft = makeDraft(tmp(), repo, sha);
    expect(fs.readFileSync(path.join(draft, "status.txt"), "utf8")).toContain(`HEAD: ${sha}`);

    const res = prOpen({
      draftDir: draft,
      forkOwner,
      upstreamUrl: upstream,
      forkUrl: fork,
      csvPath: path.join(tmp(), "data", "prs.csv"),
      workDir: tmp("shim-pr-work-"),
      env: gitEnv,
    });
    expect(res).toMatchObject({ ok: true, repo, branch: PR_BRANCH });

    // The branch exists on the fork bare repo, with the commit and the applied patch.
    expect(onBare(fork, "log", "--oneline", PR_BRANCH).output).toContain("Upgrade to AI SDK 7");
    expect(onBare(fork, "show", `${PR_BRANCH}:index.js`).output).toContain("let x = 1;");
    // The patch file itself is not committed.
    expect(onBare(fork, "ls-files", PR_BRANCH).output).not.toContain("changes.patch");
    // The compare URL points at the fork's branch with ?expand=1; pr.md is named too.
    expect(res.compareUrl).toBe(`https://github.com/${repo}/compare/main...${forkOwner}:${PR_BRANCH}?expand=1`);
    expect(res.prPath).toBe(path.join(draft, "pr.md"));
  });
});

describe("prOpen refusal when prs.csv already tracks the repo", () => {
  it("stops with already-tracked and leaves the fork untouched", () => {
    const { upstream, fork, forkOwner, repo } = setup();
    const draft = makeDraft(tmp(), repo, "");
    const csv = path.join(tmp(), "data", "prs.csv");
    appendCsvRow(csv, [repo, "", "", "https://github.com/acct/demo/pull/1", "2026-01-01", "open", "", "", ""]);
    expect(csvHasRow(fs.readFileSync(csv, "utf8"), repo)).toBe(true);

    const res = prOpen({
      draftDir: draft,
      forkOwner,
      upstreamUrl: upstream,
      forkUrl: fork,
      csvPath: csv,
      workDir: tmp("shim-pr-work-"),
      env: gitEnv,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("already-tracked");
    expect(onBare(fork, "branch", "-a").output).not.toContain(PR_BRANCH);
  });
});

describe("drift check", () => {
  it("stops with a drift warning when upstream has moved since the draft was cut", () => {
    const { upstream, fork, forkOwner, repo } = setup();
    const draft = makeDraft(tmp(), repo, "0".repeat(40)); // a stale recorded HEAD

    const res = prOpen({
      draftDir: draft,
      forkOwner,
      upstreamUrl: upstream,
      forkUrl: fork,
      csvPath: path.join(tmp(), "prs.csv"),
      workDir: tmp("shim-pr-work-"),
      env: gitEnv,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("drift");
    expect(res.detail).toMatch(/re-cut the draft or pass --allow-drift/);
    expect(onBare(fork, "branch", "-a").output).not.toContain(PR_BRANCH);
  });

  it("with allowDrift, proceeds and pushes even though upstream has moved", () => {
    const { upstream, fork, forkOwner, repo } = setup();
    const draft = makeDraft(tmp(), repo, "0".repeat(40));

    const res = prOpen({
      draftDir: draft,
      forkOwner,
      allowDrift: true,
      upstreamUrl: upstream,
      forkUrl: fork,
      csvPath: path.join(tmp(), "prs.csv"),
      workDir: tmp("shim-pr-work-"),
      env: gitEnv,
    });
    expect(res.ok).toBe(true);
    expect(onBare(fork, "log", "--oneline", PR_BRANCH).output).toContain("Upgrade to AI SDK 7");
  });

  it("no drift when the recorded HEAD matches the current upstream", () => {
    const { upstream, fork, forkOwner, repo } = setup();
    const head = onBare(upstream, "rev-parse", "main").output.trim();
    const draft = makeDraft(tmp(), repo, head);

    const res = prOpen({
      draftDir: draft,
      forkOwner,
      upstreamUrl: upstream,
      forkUrl: fork,
      csvPath: path.join(tmp(), "prs.csv"),
      workDir: tmp("shim-pr-work-"),
      env: gitEnv,
    });
    expect(res).toMatchObject({ ok: true, upstreamHead: head });
  });
});

describe("prRecord", () => {
  it("appends a well-formed row", () => {
    const file = path.join(tmp(), "data", "prs.csv");
    const r = prRecord({ repo: "acct/demo", prUrl: "https://github.com/acct/demo/pull/1", csvPath: file, today: "2026-02-02" });
    expect(fs.readFileSync(file, "utf8")).toBe(
      "repo,stars,last_commit,pr_url,opened_at,state,merged_at,comments,notes\nacct/demo,,,https://github.com/acct/demo/pull/1,2026-02-02,open,,,\n",
    );
    expect(r.row).toContain("acct/demo");
    expect(csvHasRow(fs.readFileSync(file, "utf8"), "acct/demo")).toBe(true);
  });

  it("appends onto an existing file and keeps its rows", () => {
    const file = path.join(tmp(), "prs.csv");
    prRecord({ repo: "acct/demo", prUrl: "https://github.com/acct/demo/pull/1", csvPath: file, today: "2026-02-02" });
    prRecord({ repo: "acct/other", prUrl: "https://github.com/acct/other/pull/2", csvPath: file, today: "2026-02-03" });
    const lines = fs.readFileSync(file, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("acct/other,,,https://github.com/acct/other/pull/2,2026-02-03,open,,,");
    expect(csvHasRow(lines.join("\n"), "acct/other")).toBe(true);
  });

  it("csvQuote quotes only when the field has a comma, quote or newline", () => {
    expect(csvQuote("a,b")).toBe('"a,b"');
    expect(csvQuote('say "hi"')).toBe('"say ""hi"""');
    expect(csvQuote("plain")).toBe("plain");
    expect(csvQuote("x\ny")).toBe('"x\ny"');
  });
});

describe("helpers", () => {
  it("draftRepo splits the owner__repo dir name, or falls back to report.json", () => {
    expect(draftRepo("/x/drafts/acct__demo")).toBe("acct/demo");
    expect(draftRepo("/x/drafts/a__b__c")).toBe("a__b/c"); // the last __ is the separator
    expect(draftRepo("/x/drafts/justrepo")).toBe("");
    expect(draftRepo("/x/drafts/justrepo", { repo: "owner/x" })).toBe("owner/x");
  });

  it("recordedHead reads the last well-formed HEAD: line", () => {
    expect(recordedHead("ready\nHEAD: " + "a".repeat(40) + "\n")).toBe("a".repeat(40));
    expect(recordedHead("HEAD: not-a-sha")).toBeUndefined();
    expect(recordedHead(undefined)).toBeUndefined();
  });

  it("compareUrl builds the expand URL", () => {
    expect(compareUrl("acct/demo", "main", "acct")).toBe(
      `https://github.com/acct/demo/compare/main...acct:${PR_BRANCH}?expand=1`,
    );
  });
});
