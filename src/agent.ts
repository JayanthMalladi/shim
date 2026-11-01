import { DEFAULT_ARCH, REVIEWER_RULES, type Architecture } from "./arch.js";
import { costUnpriced, run, runAgentBackend, type ExecResult } from "./exec.js";
import { resolveModel } from "./evolve-guard.js";
import type { Finding } from "./types.js";

/**
 * Resolve the judge model from the environment. The hard-coded value in agent.ts (around line 131)
 * is kept only as a fallback when SHIM_JUDGE_MODEL is unset. If the env var is set to an empty
 * string the call fails with a clear error, because an empty model id would reach the CLI silently.
 */
export function judgeModel(): string {
  return resolveModel("judge", "claude-opus-5-5");
}

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

  const args = [
    "-p", prompt,
    "--model", arch.fixerModel,
    "--max-turns", String(arch.fixerMaxTurns),
    ...(costUnpriced() ? [] : ["--max-budget-usd", "3"]),
    "--permission-mode", "acceptEdits",
    "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Bash(npx --no-install tsc:*)", "Bash(git diff:*)",
    ...(arch.fixerChecks ? ["Bash(cd:*)", "Bash(npm run:*)", "Bash(pnpm run:*)", "Bash(yarn run:*)", "Bash(bun run:*)", "Bash(npx --no-install:*)"] : []),
    "--output-format", "json",
  ];
  return runAgentBackend(args, dir, (arch.fixerChecks ? 45 : 30) * 60_000, prompt);
}

export interface Review {
  approve: boolean;
  issues: string[];
  output: string;
  /** null when the backend is unpriced (dsh or ANTHROPIC_BASE_URL); 0-based otherwise. */
  cost: number | null;
}

/**
 * A read-only agent that never saw the fixer's reasoning reviews the whole diff.
 * It looks for what the gates can't see: changed behavior, edits outside the migration, weakened tests.
 */
export async function runReviewer(dir: string, rules = REVIEWER_RULES, model?: string): Promise<Review> {
  const resolvedModel = model ?? resolveModel("reviewer", DEFAULT_ARCH.reviewerModel);
  // Snapshot the tree before the agent runs: the reviewer is read-only, so if its run ends with a
  // modified tree (a prompt-injection or a tool that slipped past the allowlist) we restore the
  // original state and discard the verdict rather than let a reviewer's edits become part of the
  // candidate diff the judge then scores.
  const diffBefore = run("git", ["diff", "HEAD", "--binary"], dir, 60_000).output;
  const statusBefore = run("git", ["status", "--porcelain"], dir, 60_000).output;
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
  const unpriced = costUnpriced();
  let cost: number | null = unpriced ? null : 0;
  let last = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const p = attempt === 1 ? prompt : `${prompt}\nBe efficient: look at the diff first and only open files you need. You must end with the JSON line.`;
    const args = [
      "-p", p,
      "--model", resolvedModel,
      "--max-turns", "50",
      ...(unpriced ? [] : ["--max-budget-usd", "3"]),
      "--allowedTools", "Read", "Glob", "Grep", "Bash(git diff:*)", "Bash(git status:*)",
      "--output-format", "json",
    ];
    const res = await runAgentBackend(args, dir, 20 * 60_000, p);
    if (!unpriced) cost = (cost ?? 0) + (res.cost ?? 0);
    last = res.text ?? res.output;
    const verdict = parseReview(last);
    if (verdict.issues[0] !== NO_VERDICT) {
      // Restore the tree if the reviewer modified anything: its job is read-only, and a diff it
      // left behind would otherwise flow into the candidate's result and into the judge's score.
      const diffAfter = run("git", ["diff", "HEAD", "--binary"], dir, 60_000).output;
      const statusAfter = run("git", ["status", "--porcelain"], dir, 60_000).output;
      if (diffAfter !== diffBefore || statusAfter !== statusBefore) {
        run("git", ["checkout", "--", "."], dir, 60_000);
        run("git", ["clean", "-fd"], dir, 60_000);
        return { approve: false, issues: ["reviewer modified files; result discarded"], output: last.slice(-2000), cost };
      }
      return { ...verdict, output: last, cost };
    }
  }
  // No verdict on either attempt: restore the tree too, in case a partial run left edits behind.
  const diffAfter = run("git", ["diff", "HEAD", "--binary"], dir, 60_000).output;
  const statusAfter = run("git", ["status", "--porcelain"], dir, 60_000).output;
  if (diffAfter !== diffBefore || statusAfter !== statusBefore) {
    run("git", ["checkout", "--", "."], dir, 60_000);
    run("git", ["clean", "-fd"], dir, 60_000);
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
- Any added cast or suppression (\`as unknown as\`, \`as any\`, \`@ts-ignore\`, \`@ts-expect-error\`) sits on code that
  the upgrade made fail to type check, hiding a real mismatch. Check the whole diff, tests included.
- Any added explicit type annotation on an exported function or constant (return type, \`Tool<...>\`) used to
  satisfy the compiler. Compare each exported signature before and after.
- Any test edit beyond type-only changes the new API requires: a changed assertion or expectation, a deleted or
  skipped test, or a changed mock return value.
- The diff leaves code that cannot compile, references names that do not exist, or renames anything this
  package exports.`;

export const runJudge = (dir: string) => runReviewer(dir, JUDGE_RULES, judgeModel());

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
