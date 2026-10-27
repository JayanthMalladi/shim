import { DEFAULT_ARCH, REVIEWER_RULES, type Architecture } from "./arch.js";
import { runAsync, type ExecResult } from "./exec.js";
import type { Finding } from "./types.js";

export interface FixBrief {
  findings: Finding[];
  /** Output of checks that passed before the upgrade and fail now. */
  failures: string;
  /** Issues an internal reviewer raised on this candidate's previous diff. */
  reviewIssues?: string[];
  /** Shell commands for the gates, shown to the fixer when it may run them. */
  checks?: string[];
}

/**
 * Hand what Shim can't fix deterministically to a headless Claude Code run.
 * The agent gets a narrow brief: fix exactly these sites, keep v6 behavior, touch nothing else.
 */
export function runFixer(dir: string, brief: FixBrief, arch: Architecture = DEFAULT_ARCH): Promise<ExecResult> {
  const { findings, failures, reviewIssues = [] } = brief;
  const nothingListed = !findings.length && !failures && !reviewIssues.length;
  const prompt = [
    "You are finishing an AI SDK 6 -> 7 migration in this repository. Dependencies are already bumped",
    "and the official codemod has run. Fix only what is listed below.",
    "",
    arch.fixerRules,
    "",
    "Reference: node_modules/ai/docs/08-migration-guides/23-migration-guide-7-0.mdx",
    "",
    ...(arch.audit
      ? [
          "Also audit every generateText, streamText, generateObject, streamObject and Agent call in the repo's",
          "source (not node_modules). For each one that runs several steps (stopWhen or maxSteps set, or an Agent), check every",
          "read of usage, toolCalls, toolResults, content, text, reasoning, files, sources, finishReason, warnings,",
          "response.messages and onFinish/onEnd/onStepFinish event fields. If v7 changed what it means, fix it as the",
          "rules say. Leave correct code alone.",
          "",
        ]
      : []),
    "Findings:",
    ...(arch.fixerChecks && brief.checks?.length
      ? ["You may run these checks yourself to verify your fix (they are what decides whether this ships):", ...brief.checks.map((c) => `- ${c}`), ""]
      : []),
    ...(findings.length ? [] : [nothingListed && arch.audit ? "- none; only do the audit above" : "- none; only fix what is listed below"]),
    ...findings.map((f) => `- ${f.file}:${f.line} [${f.ruleId}] ${f.message}\n  code: ${f.snippet}`),
    ...(failures ? ["", "Checks that passed before the upgrade and fail now:", failures.slice(-8000)] : []),
    ...(reviewIssues.length
      ? ["", "A reviewer rejected your previous diff for these reasons. Fix each one, or undo the edit that caused it:", ...reviewIssues.map((i) => `- ${i}`)]
      : []),
  ].join("\n");

  return runAsync(
    "claude",
    [
      "-p", prompt,
      "--model", arch.fixerModel,
      "--max-turns", String(arch.fixerMaxTurns),
      "--max-budget-usd", "3",
      "--permission-mode", "acceptEdits",
      "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Bash(npx --no-install tsc:*)", "Bash(git diff:*)",
      ...(arch.fixerChecks ? ["Bash(cd:*)", "Bash(npm run:*)", "Bash(pnpm run:*)", "Bash(yarn run:*)", "Bash(bun run:*)", "Bash(npx --no-install:*)"] : []),
      "--output-format", "json",
    ],
    dir,
    (arch.fixerChecks ? 45 : 30) * 60_000,
  );
}

export interface Review {
  approve: boolean;
  issues: string[];
  output: string;
  cost: number;
}

/**
 * A read-only agent that never saw the fixer's reasoning reviews the whole diff.
 * It looks for what the gates can't see: changed behavior, edits outside the migration, weakened tests.
 */
export async function runReviewer(dir: string, rules = REVIEWER_RULES, model = DEFAULT_ARCH.reviewerModel): Promise<Review> {
  const prompt = [
    "Review the uncommitted diff in this repository (`git diff`, plus untracked files from `git status`).",
    "It upgrades the project from AI SDK 6 to 7. A maintainer will merge it only if it is a pure upgrade.",
    "",
    rules,
    "",
    "Reference: node_modules/ai/docs/08-migration-guides/23-migration-guide-7-0.mdx",
    "Ignore package.json version ranges and lockfiles. Do not edit files.",
    'End with one line of JSON and nothing after it: {"approve": true|false, "issues": ["file:line what is wrong"]}',
  ].join("\n");
  // A run that errors out or ends without a verdict (API error, turn limit) gets one more try.
  let cost = 0;
  let last = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await runAsync(
      "claude",
      [
        "-p", attempt === 1 ? prompt : `${prompt}\nBe efficient: look at the diff first and only open files you need. You must end with the JSON line.`,
        "--model", model,
        "--max-turns", "50",
        "--max-budget-usd", "3",
        "--allowedTools", "Read", "Glob", "Grep", "Bash(git diff:*)", "Bash(git status:*)",
        "--output-format", "json",
      ],
      dir,
      20 * 60_000,
    );
    cost += res.cost ?? 0;
    last = res.text ?? res.output;
    const verdict = parseReview(last);
    if (verdict.issues[0] !== NO_VERDICT) return { ...verdict, output: last, cost };
  }
  return { approve: false, issues: [NO_VERDICT], output: last.slice(-2000), cost };
}

const NO_VERDICT = "reviewer gave no verdict";

/**
 * The fixed judge that scores architectures. It never changes during evolution, so a variant can't
 * improve its score by weakening its own reviewer. Stricter than the internal reviewer on purpose.
 */
export const JUDGE_RULES = `${REVIEWER_RULES}
- Any call that runs several steps (stopWhen or maxSteps set, or an Agent) still reads usage, toolCalls, toolResults,
  content, text, response.messages, or onFinish/onEnd event fields with their v6 meaning, without finalStep
  or responseMessages. Check every such call in the repo, not only the lines in the diff.
- The diff leaves code that cannot compile, references names that do not exist, or renames anything this
  package exports.`;

export const runJudge = (dir: string) => runReviewer(dir, JUDGE_RULES, "claude-opus-5-5");

/** The verdict is the last JSON line. Anything unparseable counts as a rejection. */
export function parseReview(output: string): Omit<Review, "output" | "cost"> {
  const line = output.trim().split("\n").reverse().find((l) => l.trim().startsWith("{") && l.includes("approve"));
  try {
    const v = JSON.parse(line ?? "");
    return { approve: v.approve === true, issues: Array.isArray(v.issues) ? v.issues.map(String) : [] };
  } catch {
    return { approve: false, issues: [NO_VERDICT] };
  }
}
