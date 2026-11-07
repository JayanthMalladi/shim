import type { Project } from "ts-morph";
import type { RuleContext } from "./rules/ai-sdk-v7.js";
import { checkCiNodeVersions, checkPackageJsons, findAiPackages, findPackages } from "./scan.js";
import { scanAiSdkV7 } from "./rules/ai-sdk-v7.js";
import { allowsMajor, bumpAiSdk, bumpZod } from "./bump.js";
import { applyAutoFixes } from "./rules/ai-sdk-v7.js";
import { scanZodV4 } from "./rules/zod-v4.js";
import { runZodCodemod } from "./zod-codemod.js";
import { FIXER_RULES, REVIEWER_RULES } from "./arch.js";
import { JUDGE_RULES } from "./agent.js";
import { run } from "./exec.js";

export interface Migration {
  id: "ai-sdk-v7" | "zod-v4";
  /** Human name used in PR text: "AI SDK 7", "Zod 4". */
  title: string;
  /** package.json files that depend on the old major (dependencies, devDependencies, peerDependencies). */
  findPackages(root: string): Array<{ file: string; range: string }>;
  /** True when a range is on the old major and does not already allow the new one. */
  isOldMajor(range: string): boolean;
  /** Bump to the new major in place; returns "name (path, field): from -> to" lines. */
  bump(root: string): string[];
  /** Run the migration's codemod in dir; returns ok. */
  codemod(dir: string): boolean;
  /** Shim's own rules, and their deterministic rewrites. */
  scan(project: Project, root: string): RuleContext;
  applyAutoFixes(project: Project, ctx: RuleContext): Promise<number>;
  /** Text the agents get. */
  fixerIntro: string;
  reviewerIntro: string;
  reference: string;
  fixerRules: string;
  reviewerRules: string;
  judgeRules: string;
  /** Git and PR text. */
  prBranch: string;
  commitMessage: string;
  changesetFile: string;
  changesetText: string;
  /** One line, "migration: <id>", appended to a draft's status.txt so `pr open` replays it. */
  statusLine: string;
}

/**
 * The existing AI SDK 6 -> 7 migration. Every field references the existing functions and strings;
 * none of the rule text is copied here, so `git diff` on src/arch.ts and src/rules/ai-sdk-v7.ts
 * stays empty. `judgeRules` is a getter: agent.ts and migrations.ts import each other, so reading
 * JUDGE_RULES at migrations.ts module-eval time would hit agent.ts still initializing; a getter
 * defers the read to call time, by which point both modules are fully loaded.
 */
export const AI_SDK_V7: Migration = {
  id: "ai-sdk-v7",
  title: "AI SDK 7",
  findPackages: findAiPackages,
  isOldMajor: (range) => /(^|[\^~>=\s])6(\.|$)/.test(range),
  bump: (root) => bumpAiSdk(root),
  codemod: (dir) => run("npx", ["-y", "@ai-sdk/codemod@4", "v7", "."], dir).ok,
  scan: (project, root) => {
    const ctx = scanAiSdkV7(project, root);
    ctx.findings.push(...checkPackageJsons(root));
    ctx.findings.push(...checkCiNodeVersions(root, ctx));
    return ctx;
  },
  applyAutoFixes,
  fixerIntro:
    "You are finishing an AI SDK 6 -> 7 migration in this repository. Dependencies are already bumped\n" +
    "and the official codemod has run. Fix only what is listed below.",
  reviewerIntro: "It upgrades the project from AI SDK 6 to 7. A maintainer will merge it only if it is a pure upgrade.",
  reference: "node_modules/ai/docs/08-migration-guides/23-migration-guide-7-0.mdx",
  fixerRules: FIXER_RULES,
  reviewerRules: REVIEWER_RULES,
  get judgeRules() {
    return JUDGE_RULES;
  },
  prBranch: "shim/ai-sdk-7",
  commitMessage: "Upgrade to AI SDK 7",
  changesetFile: "upgrade-ai-sdk-7.md",
  changesetText: "Upgrade to AI SDK 7. Requires ai@7 and Node.js 22 or later.",
  statusLine: "migration: ai-sdk-v7",
};

/** The Zod fixer's rules, word for word. Behavior-preserving by design; no AI SDK words. */
const ZOD_FIXER_RULES = `Rules:
- Preserve the program's Zod 3 runtime behavior exactly: the same inputs must parse to the same outputs
  and fail in the same cases. Known Zod 4 differences and their behavior-preserving fixes:
  .default() before .optional()/.nullish() -> remove the .default(); .default() after a transform or
  trim/toLowerCase/toUpperCase, or on an object schema -> .prefault(); string().uuid() -> string().guid();
  z.record with enum or literal keys -> z.partialRecord(); a z.unknown()/z.any() object field -> add
  .optional(); ZodError.errors -> .issues.
- Code that reads Zod 3 internals must read Zod 4's instead, or it silently stops working: Zod 3's
  \`_def.typeName\` ('ZodOptional', 'ZodNumber', ...) is Zod 4's \`_def.type\` ('optional', 'number', ...);
  wrappers (optional, default, nullable) keep \`_def.innerType\`; an array's element is \`_def.element\`,
  not \`_def.type\`. \`ZodIssue.path\` is \`PropertyKey[]\` in Zod 4.
- Make the smallest edit at each site. No refactors, no formatting changes, no new dependencies.
- Never change a function's signature or an exported schema's name.
- The codemod's edits are in \`git diff\`. If one of them is wrong, revert that edit.
- Error message text changed in Zod 4. If a test asserts an exact Zod error message, do not change the
  assertion: leave the site and report it.
- Never silence a type error with \`as any\`, \`as unknown as\`, \`@ts-ignore\` or \`@ts-expect-error\`.
- If a site cannot be fixed safely, leave it and say why in your final message.
- Finish by running \`npx --no-install tsc --noEmit -p tsconfig.json\` if a tsconfig.json exists.`;

const ZOD_REVIEWER_RULES = `Reject it if any of these is true:
- Runtime behavior changes beyond what Zod 4 forces. In Zod 4, \`.default()\` before \`.optional()\`,
  \`.nullish()\` or a transform behaves differently; \`string().uuid()\` rejects non-RFC UUIDs;
  \`z.record\` takes string keys only; a \`z.unknown()\`/\`z.any()\` object field is non-optional; and
  \`ZodError.errors\` is \`.issues\`. Zod 3 internals (\`_def.typeName\`) became Zod 4's (\`_def.type\`,
  \`_def.element\`). A behavior-preserving fix for one of these is not a behavior
  change and is not a reason to reject.
- An edit has nothing to do with the upgrade (refactors, renames, reformatting of untouched code).
- A type error from the upgrade is hidden with \`as unknown as\`, \`as any\`, \`@ts-ignore\`,
  \`@ts-expect-error\` or a similar cast or suppression instead of fixed.
- A test is deleted, skipped, or loosened, or an assertion changes (including an exact Zod error-message
  assertion), unless the edit only reverts a wrong codemod edit or is a minimal type-only change the
  new API requires.
- A function's signature changes or an exported schema's name changes.`;

/** Stricter than the reviewer, mirroring agent.ts's JUDGE_RULES: judgeRules extends reviewerRules. */
const ZOD_JUDGE_RULES = `${ZOD_REVIEWER_RULES}
- The diff leaves code that cannot compile, references names that do not exist, or renames anything this
  package exports.
- A site that cannot be fixed safely was forced anyway (a cast, a widened type, a loosened test)
  instead of being left for the maintainer.`;

/**
 * The Zod 3 -> 4 migration. The agent prompts are Zod-specific on purpose: they never
 * mention AI SDK, and the judge's rules strictly extend the reviewer's.
 */
export const ZOD_V4: Migration = {
  id: "zod-v4",
  title: "Zod 4",
  findPackages: (root) => findPackages(root, "zod"),
  isOldMajor: (range) => allowsMajor(range, 3) && !allowsMajor(range, 4),
  bump: (root) => bumpZod(root),
  codemod: runZodCodemod,
  scan: scanZodV4,
  applyAutoFixes,
  fixerIntro:
    "You are finishing a Zod 3 -> 4 migration in this repository. Dependencies are already bumped\n" +
    "and the community codemod (zod-v3-to-v4) has run. Fix only what is listed below.",
  reviewerIntro:
    "It upgrades the project from Zod 3 to 4. A maintainer will merge it only if it is a pure upgrade.\n" +
    "You can read files and run only `git diff` and `git status`; other commands are denied. The build, typecheck " +
    "and tests already ran on this diff, so do not try to run them or install packages.",
  reference: "https://zod.dev/v4/changelog (you can't open it here; the rules above list every Zod 4 change that matters)",
  fixerRules: ZOD_FIXER_RULES,
  reviewerRules: ZOD_REVIEWER_RULES,
  judgeRules: ZOD_JUDGE_RULES,
  prBranch: "shim/zod-4",
  commitMessage: "Upgrade to Zod 4",
  changesetFile: "upgrade-zod-4.md",
  changesetText: "Upgrade to Zod 4. Requires zod@4.",
  statusLine: "migration: zod-v4",
};

export const MIGRATIONS: Partial<Record<Migration["id"], Migration>> = {
  "ai-sdk-v7": AI_SDK_V7,
  "zod-v4": ZOD_V4,
};

export function getMigration(id?: Migration["id"]): Migration {
  if (id === undefined) return AI_SDK_V7;
  const m = MIGRATIONS[id];
  if (!m) throw new Error(`unknown migration "${id}"; known: ${Object.keys(MIGRATIONS).join(", ")}`);
  return m;
}