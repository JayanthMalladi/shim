/**
 * Opening the PRs Shim drafts. A draft lives in drafts/<owner>__<repo>/: status.txt
 * (last line "HEAD: <sha>" — the upstream HEAD it was cut against), pr.md, and
 * `changes.patch`. `prOpen` replays the patch on a fresh fork branch, pushes it, and
 * prints the compare URL; a human opens the PR from there. `prRecord` adds the row to
 * data/prs.csv that promises we never open a second PR on a repo.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run, agentEnv, type ExecResult } from "./exec.js";

const log = (m: string) => console.error(`[pr] ${m}`);
export const PR_BRANCH = "shim/ai-sdk-7";

/** The "HEAD: <sha>" line recorded at the end of status.txt: the upstream HEAD the draft was cut against. */
export function recordedHead(statusTxt: string | undefined): string | undefined {
  const lines = (statusTxt ?? "").trimEnd().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i]!.match(/^HEAD:\s*([0-9a-f]{40})$/i);
    if (m) return m[1]!.toLowerCase();
  }
  return undefined;
}

/**
 * The upstream repo a draft is for: the draft dir name (<owner>__<repo>) when it splits
 * on __, else the "repo" field of report.json.
 */
export function draftRepo(draftDir: string, report?: { repo?: string } | null): string {
  const base = path.basename(path.resolve(draftDir));
  const i = base.lastIndexOf("__");
  if (i > 0 && i < base.length - 1) return base.slice(0, i) + "/" + base.slice(i + 2);
  return report?.repo ?? "";
}

/** https://github.com/<owner>/<repo>/compare/<default>...<fork>:shim/ai-sdk-7?expand=1 */
export function compareUrl(repo: string, defaultBranch: string, forkOwner: string): string {
  return `https://github.com/${repo}/compare/${defaultBranch}...${forkOwner}:${PR_BRANCH}?expand=1`;
}

// --- data/prs.csv -----------------------------------------------------------

/** Quote a CSV field only when it needs quoting; embedded quotes double up. */
export function csvQuote(field: string): string {
  return /[",\n\r]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

export function csvRow(fields: string[]): string {
  return fields.map(csvQuote).join(",");
}

/** True when prs.csv already has a row for this repo, whatever its state. */
export function csvHasRow(csv: string | undefined, repo: string): boolean {
  for (const line of (csv ?? "").split("\n")) {
    const first = line.split(",")[0]?.trim();
    if (first) {
      if (first === repo) return true;
      if (first.startsWith('"') && first.endsWith('"') && first.slice(1, -1) === repo) return true;
    }
  }
  return false;
}

/** Append one row, creating the file with the header when it does not exist yet. */
export function appendCsvRow(file: string, fields: string[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const base = existing === "" ? "repo,stars,last_commit,pr_url,opened_at,state,merged_at,comments,notes\n" :
    !existing.endsWith("\n") ? existing + "\n" : existing;
  fs.writeFileSync(file, base + csvRow(fields) + "\n");
}

// --- pr record --------------------------------------------------------------

export interface PrRecordOptions {
  /** owner/repo, as it appears in the first column of data/prs.csv. */
  repo: string;
  prUrl: string;
  /** The data/prs.csv to append to. Default: data/prs.csv under the process cwd. */
  csvPath?: string;
  /** Date written as opened_at. Default: today, YYYY-MM-DD. */
  today?: string;
}

/** data/prs.csv lives at the repo root, one level up from src/ in a checkout. */
export function defaultCsvPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "prs.csv");
}

/** Append repo,,,<prUrl>,<today>,open,,,, to data/prs.csv (stars/last_commit stay empty). */
export function prRecord(opts: PrRecordOptions): { file: string; row: string } {
  const file = opts.csvPath ?? defaultCsvPath();
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const row = csvRow([opts.repo, "", "", opts.prUrl, today, "open", "", "", ""]);
  appendCsvRow(file, [opts.repo, "", "", opts.prUrl, today, "open", "", "", ""]);
  return { file, row };
}

// --- pr open ----------------------------------------------------------------

export interface PrOpenOptions {
  /** drafts/<owner>__<repo>: status.txt + changes.patch + pr.md. */
  draftDir: string;
  /** The fork that will receive the shim/ai-sdk-7 branch. */
  forkOwner: string;
  /** Where the upstream is cloned from. Default: https://github.com/<owner>/<repo>. */
  upstreamUrl?: string;
  /** Where the fork is cloned from. Default: https://github.com/<forkOwner>/<repo>. */
  forkUrl?: string;
  /** git apply proceeds even when the upstream HEAD has moved past the draft's. */
  allowDrift?: boolean;
  /** Where temp clones live. Default: a fresh OS tmp dir, removed on success. */
  workDir?: string;
  /** The data/prs.csv that tracks every opened PR. */
  csvPath?: string;
  /** Environment the git commands run in (tests set a private HOME). */
  env?: NodeJS.ProcessEnv;
}

export interface PrOpenResult {
  ok: boolean;
  reason?: "already-tracked" | "drift" | "conflict" | "git-failed" | "draft" | "upstream-moved";
  gitOutput?: string;
  detail?: string;
  repo?: string;
  forkOwner?: string;
  branch?: string;
  upstreamHead?: string;
  compareUrl?: string;
  prPath?: string;
}

/**
 * Replay a draft's changes.patch on a fresh shim/ai-sdk-7 branch of the fork and push it.
 * Nothing is opened: the result is the compare URL plus the path to pr.md, for a human
 * or CI to open the PR. On failure the reason is set and the output (gitOutput, detail)
 * says why; the temp clones are left in place to inspect.
 */
export function prOpen(opts: PrOpenOptions): PrOpenResult {
  const draft = path.resolve(opts.draftDir);
  if (!fs.existsSync(draft)) return { ok: false, reason: "draft", detail: `no such draft dir: ${draft}` };
  const report: { repo?: string } | null = fs.existsSync(path.join(draft, "report.json"))
    ? JSON.parse(fs.readFileSync(path.join(draft, "report.json"), "utf8"))
    : null;
  const repo = draftRepo(draft, report);
  if (!repo) return { ok: false, reason: "draft", detail: `cannot work out <owner>/<repo> from ${path.basename(draft)}` };

  const csv = opts.csvPath ?? defaultCsvPath();
  if (csvHasRow(fs.existsSync(csv) ? fs.readFileSync(csv, "utf8") : undefined, repo)) {
    return { ok: false, repo, reason: "already-tracked", detail: `${repo} is already in data/prs.csv; we never open a second PR on a repo` };
  }
  const env = opts.env ?? agentEnv();
  const git = (args: string[], cwd: string, timeoutMs?: number): ExecResult =>
    run("git", args, cwd, timeoutMs ?? 5 * 60_000, env);
  const fail = (reason: PrOpenResult["reason"], gitOutput?: string, detail?: string): PrOpenResult =>
    ({ ok: false, repo, reason, gitOutput, detail });

  const prMd = path.join(draft, "pr.md");
  const work = opts.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "shim-pr-"));
  fs.mkdirSync(work, { recursive: true });

  // Upstream: need the current HEAD sha and the default branch for the compare URL.
  const up = path.join(work, "upstream");
  // autocrlf=false keeps the work tree byte-identical to the remote, so the patch applies cleanly.
  if (git(["-c", "core.autocrlf=false", "clone", "-q", "--single-branch", opts.upstreamUrl ?? `https://github.com/${repo}`, up], work).ok) {
    const def = git(["rev-parse", "--abbrev-ref", "HEAD"], up);
    const head = git(["rev-parse", "HEAD"], up);
    if (!def.ok || !head.ok) return fail("git-failed", def.output, `cannot read upstream HEAD: ${head.output.trim()}`);
    const recorded = recordedHead(fs.existsSync(path.join(draft, "status.txt")) ? fs.readFileSync(path.join(draft, "status.txt"), "utf8") : undefined);
    const upstreamHead = head.output.trim().toLowerCase();
    if (recorded !== undefined && recorded !== upstreamHead && !opts.allowDrift) {
      log(`drift: draft was cut against ${recorded}, upstream HEAD is ${upstreamHead}`);
      return fail("drift", undefined, `draft was cut against ${recorded}, upstream HEAD is ${upstreamHead}; re-cut the draft or pass --allow-drift`);
    }

    // The patch applies to the fork's default branch, whose history matches upstream's. A fork of
    // owner/repo lives at <forkOwner>/repo (forks drop the upstream owner from the path).
    const forkName = repo.split("/").pop()!;
    const fork = path.join(work, "fork");
    if (git(["-c", "core.autocrlf=false", "clone", "-q", "--single-branch", opts.forkUrl ?? `https://github.com/${opts.forkOwner}/${forkName}`, fork], work).ok) {
      if (!git(["checkout", "-q", "-b", PR_BRANCH], fork).ok) return fail("git-failed", undefined, `cannot create ${PR_BRANCH} on the fork`);
      fs.writeFileSync(path.join(fork, "changes.patch"), fs.readFileSync(path.join(draft, "changes.patch"), "utf8"));
      // Plain apply first: the patch was generated against the same HEAD, so it applies without
      // needing the index; --3way is the fallback for small upstream drift.
      let apply = git(["apply", "changes.patch"], fork);
      if (!apply.ok) apply = git(["apply", "--3way", "changes.patch"], fork);
      if (!apply.ok) {
        // Leave the patch behind so the conflict can be inspected.
        return fail("conflict", apply.output, "conflict applying the patch; regenerate this draft against the current HEAD");
      }
      fs.rmSync(path.join(fork, "changes.patch"), { force: true });
      if (!git(["add", "-A"], fork).ok || !git(["commit", "-q", "-m", "Upgrade to AI SDK 7"], fork).ok) {
        return fail("git-failed", undefined, "cannot commit the applied patch on the fork");
      }
      const push = git(["push", "-q", "-u", "origin", PR_BRANCH], fork, 5 * 60_000);
      if (!push.ok) return fail("git-failed", push.output, `cannot push ${PR_BRANCH} to the fork`);
      fs.rmSync(work, { recursive: true, force: true });
      const defaultBranch = def.output.trim();
      return {
        ok: true, repo, forkOwner: opts.forkOwner, branch: PR_BRANCH,
        upstreamHead,
        compareUrl: compareUrl(repo, defaultBranch, opts.forkOwner),
        prPath: prMd,
      };
    }
    return fail("git-failed", undefined, `cannot clone ${opts.forkUrl ?? `https://github.com/${opts.forkOwner}/${repo.split("/").pop()}`}`);
  }
  return fail("git-failed", undefined, `cannot clone ${opts.upstreamUrl ?? `https://github.com/${repo}`}`);
}
