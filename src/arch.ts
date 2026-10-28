/**
 * An architecture is everything about the fix stage that can vary: how many fixers, how they retry,
 * what they are told, and who reviews them. The evolution loop (scripts/evolve.ts) mutates these.
 */
export interface Architecture {
  id: string;
  /** Why this variant exists: the parent it came from and the hypothesis it tests. */
  notes: string;
  /** Independent fixers run in parallel on copies of the repo. */
  candidates: number;
  /** Fix -> gates rounds per candidate while checks still fail. */
  attempts: number;
  fixerModel: string;
  fixerMaxTurns: number;
  /** The fixer's rules, placed above the findings and failing checks. */
  fixerRules: string;
  /** Let the fixer run the repo's own build, type check and test commands, not just tsc. */
  fixerChecks?: boolean;
  /**
   * Run the fixer even when there are no findings and no failing checks, asking it to audit every
   * generateText/streamText call for v7's silent changes. Catches what the scanner misses.
   */
  audit: boolean;
  /** An internal reviewer must approve a candidate before it can become a PR. */
  review: boolean;
  reviewerModel: string;
  reviewerRules: string;
  /** When the reviewer rejects, send its issues back to the fixer this many times. */
  reviewRounds: number;
  /** How to pick among passing, approved candidates. */
  selection: "smallest" | "first";
}

export const FIXER_RULES = `Rules:
- Preserve the program's v6 runtime behavior exactly. When a v7 property now spans all steps, read it
  from \`finalStep\` instead (for streamText, \`result.finalStep\` is a promise).
- Make the smallest edit at each site. No refactors, no formatting changes, no new dependencies
  unless a finding says one is required.
- Never change a function's signature: keep sync functions sync, and keep parameters and return types.
  If a value is now behind a promise, chain it (e.g. \`result.finalStep.then((s) => s.toolCalls)\`).
- The codemod's edits are in \`git diff\`. If one of them is wrong (for example it changed a value that
  this repo's own types still require), revert that edit, even in a test. If a gated typecheck that covers
  tests fails because of the new API, make the minimal type-only test edit it needs (for example a
  now-required \`context\` field in a ToolExecutionOptions literal). Never change assertions or
  expectations, and never delete, skip or weaken tests.
- Never add explicit type annotations (return types, \`Tool<...>\`) to exported functions or public API to
  satisfy the compiler: that widens or changes the public type. Fix the cause, or leave the site and report it.
- Never silence an error the upgrade introduced with \`as unknown as\`, \`as any\`, \`@ts-ignore\`,
  \`@ts-expect-error\` or similar. Fix the types, or leave the site and report it.
- If a site cannot be fixed safely, leave it and say why in your final message.
- Finish by running \`npx --no-install tsc --noEmit -p tsconfig.json\` if a tsconfig.json exists.`;

export const REVIEWER_RULES = `Reject it if any of these is true:
- Runtime behavior changes beyond what AI SDK 7 forces. In v7, multi-step \`usage\`, \`toolCalls\`, \`content\`
  and similar span all steps; v6 code that meant the last step must read \`finalStep\`. \`response.messages\`
  must become \`responseMessages\`. A system message in \`messages\`/\`prompt\` needs \`allowSystemInMessages: true\`
  on the call (or the ToolLoopAgent constructor), or a move to \`instructions\`; that option keeps v6 behavior.
  This only applies to calls that can run more than one step: \`stopWhen\`/\`maxSteps\` set, or an Agent /
  ToolLoopAgent (multi-step by default). A generateText/streamText call without \`stopWhen\` runs exactly one
  step in v6 and v7, so its top-level \`usage\`, \`toolCalls\`, \`response\` etc. keep their meaning; do not
  reject those. Deprecated aliases that still work in v7 are not a reason to reject.
- An edit has nothing to do with the upgrade (refactors, renames, reformatting of untouched code).
- A type error from the upgrade is hidden with \`as unknown as\`, \`as any\`, \`@ts-ignore\`, \`@ts-expect-error\` or
  a similar cast or suppression instead of fixed.
- An explicit type annotation (return type, \`Tool<...>\`) is added to an exported function or public API,
  changing the public type.
- A test is deleted, skipped, or loosened, or an assertion or expectation changes, unless the edit only reverts
  a wrong codemod edit or is a minimal type-only change the new API requires (for example a now-required
  field in an options literal).
- A function's signature changes (sync to async, parameters, return type).`;

/** Fixer v1, the pipeline before parallel candidates: one fixer, retried, no reviewer. */
export const V1: Architecture = {
  id: "v1-single-retry",
  notes: "Baseline: the first pipeline. One fixer, up to 3 attempts on failing checks, no reviewer.",
  candidates: 1, attempts: 3, fixerModel: "claude-opus-5-5", fixerMaxTurns: 40, fixerRules: FIXER_RULES,
  audit: false, review: false, reviewerModel: "claude-opus-5-5", reviewerRules: REVIEWER_RULES, reviewRounds: 0,
  selection: "first",
};

/** Fixer v2, merged 2026-10-27: 3 parallel candidates, smallest green diff, reviewer gate. */
export const V2: Architecture = {
  ...V1,
  id: "v2-parallel-review",
  notes: "3 parallel candidates x 2 attempts, smallest green diff wins, reviewer must approve.",
  candidates: 3, attempts: 2, review: true, selection: "smallest",
};

export const DEFAULT_ARCH = V2;

/** Hand-designed seeds for generation 0, besides V1 and V2. */
export const SEEDS: Architecture[] = [
  V1,
  V2,
  {
    ...V2,
    id: "v3-review-feedback-audit",
    notes: "V2 plus: reviewer issues go back to the fixer (1 round), and the fixer audits every call even with no findings.",
    reviewRounds: 1,
    audit: true,
  },
  {
    ...V2,
    id: "v4-fixer-runs-checks",
    notes: "V2 plus: the fixer may run the repo's own build, type check and test commands, and reviewer issues go back once.",
    fixerChecks: true,
    reviewRounds: 1,
  },
];
