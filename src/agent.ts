import { runAsync, type ExecResult } from "./exec.js";
import type { Finding } from "./types.js";

export interface AgentOptions {
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
}

export const DEFAULT_AGENT: AgentOptions = { model: "claude-opus-5-5", maxTurns: 40, maxBudgetUsd: 3 };

/**
 * Hand the findings Shim can't fix deterministically to a headless Claude Code run.
 * The agent gets a narrow brief: fix exactly these sites, keep v6 behavior, touch nothing else.
 */
export function runFixer(dir: string, findings: Finding[], typeErrors: string, opts = DEFAULT_AGENT): Promise<ExecResult> {
  const prompt = [
    "You are finishing an AI SDK 6 -> 7 migration in this repository. Dependencies are already bumped",
    "and the official codemod has run. Fix only what is listed below.",
    "",
    "Rules:",
    "- Preserve the program's v6 runtime behavior exactly. When a v7 property now spans all steps, read it",
    "  from `finalStep` instead (for streamText, `result.finalStep` is a promise).",
    "- Make the smallest edit at each site. No refactors, no formatting changes, no new dependencies",
    "  unless a finding says one is required.",
    "- Never change a function's signature: keep sync functions sync, and keep parameters and return types.",
    "  If a value is now behind a promise, chain it (e.g. `result.finalStep.then((s) => s.toolCalls)`).",
    "- The codemod's edits are in `git diff`. If one of them is wrong (for example it changed a value that",
    "  this repo's own types still require), revert that edit, even in a test. Otherwise never edit or weaken",
    "  tests to make them pass.",
    "- If a site cannot be fixed safely, leave it and say why in your final message.",
    "- Finish by running `npx --no-install tsc --noEmit -p tsconfig.json` if a tsconfig.json exists.",
    "",
    "Reference: node_modules/ai/docs/08-migration-guides/23-migration-guide-7-0.mdx",
    "",
    "Findings:",
    ...(findings.length ? [] : ["- none; only fix the failing checks below"]),
    ...findings.map((f) => `- ${f.file}:${f.line} [${f.ruleId}] ${f.message}\n  code: ${f.snippet}`),
    ...(typeErrors ? ["", "Checks that passed before the upgrade and fail now:", typeErrors.slice(-8000)] : []),
  ].join("\n");

  return runAsync(
    "claude",
    [
      "-p", prompt,
      "--model", opts.model,
      "--max-turns", String(opts.maxTurns),
      "--max-budget-usd", String(opts.maxBudgetUsd),
      "--permission-mode", "acceptEdits",
      "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Bash(npx --no-install tsc:*)", "Bash(git diff:*)",
      "--output-format", "json",
    ],
    dir,
    30 * 60_000,
  );
}

export interface Review {
  approve: boolean;
  issues: string[];
  output: string;
}

/**
 * A second, read-only agent that never saw the fixer's reasoning reviews the whole diff.
 * It looks for what the gates can't see: changed behavior, edits outside the migration, weakened tests.
 */
export async function runReviewer(dir: string, opts = DEFAULT_AGENT): Promise<Review> {
  const prompt = [
    "Review the uncommitted diff in this repository (`git diff`, plus untracked files from `git status`).",
    "It upgrades the project from AI SDK 6 to 7. A maintainer will merge it only if it is a pure upgrade.",
    "",
    "Reject it if any of these is true:",
    "- Runtime behavior changes beyond what AI SDK 7 forces. In v7, multi-step `usage`, `toolCalls`, `content`",
    "  and similar span all steps; v6 code that meant the last step must read `finalStep`. `response.messages`",
    "  must become `responseMessages`. System messages must move to `instructions`.",
    "- An edit has nothing to do with the upgrade (refactors, renames, reformatting of untouched code).",
    "- A test is deleted, skipped, or loosened, unless it only reverts a wrong codemod edit.",
    "- A function's signature changes (sync to async, parameters, return type).",
    "",
    "Reference: node_modules/ai/docs/08-migration-guides/23-migration-guide-7-0.mdx",
    "Ignore package.json version ranges and lockfiles. Do not edit files.",
    'End with one line of JSON and nothing after it: {"approve": true|false, "issues": ["file:line what is wrong"]}',
  ].join("\n");
  const res = await runAsync(
    "claude",
    [
      "-p", prompt,
      "--model", opts.model,
      "--max-turns", "30",
      "--max-budget-usd", String(opts.maxBudgetUsd),
      "--allowedTools", "Read", "Glob", "Grep", "Bash(git diff:*)", "Bash(git status:*)",
      "--output-format", "text",
    ],
    dir,
    20 * 60_000,
  );
  return { ...parseReview(res.output), output: res.output };
}

/** The verdict is the last JSON line. Anything unparseable counts as a rejection. */
export function parseReview(output: string): Omit<Review, "output"> {
  const line = output.trim().split("\n").reverse().find((l) => l.trim().startsWith("{") && l.includes("approve"));
  try {
    const v = JSON.parse(line ?? "");
    return { approve: v.approve === true, issues: Array.isArray(v.issues) ? v.issues.map(String) : [] };
  } catch {
    return { approve: false, issues: ["reviewer gave no verdict"] };
  }
}
