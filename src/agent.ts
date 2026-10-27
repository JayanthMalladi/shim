import { run, type ExecResult } from "./exec.js";
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
export function runFixer(dir: string, findings: Finding[], typeErrors: string, opts = DEFAULT_AGENT): ExecResult {
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

  return run(
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
