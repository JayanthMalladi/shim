import type { Project } from "ts-morph";
import type { RuleContext } from "./rules/ai-sdk-v7.js";
import { checkCiNodeVersions, checkPackageJsons, findAiPackages, findPackages } from "./scan.js";
import { scanAiSdkV7 } from "./rules/ai-sdk-v7.js";
import { allowsMajor, bumpAiSdk, bumpExpress, bumpZod } from "./bump.js";
import { applyAutoFixes } from "./rules/ai-sdk-v7.js";
import { scanZodV4 } from "./rules/zod-v4.js";
import { checkExpressRelatedPackages, scanExpressV5 } from "./rules/express-v5.js";
import { runZodCodemod } from "./zod-codemod.js";
import { runExpressCodemod } from "./express-codemod.js";
import { FIXER_RULES, REVIEWER_RULES } from "./arch.js";
import { JUDGE_RULES } from "./agent.js";
import { run } from "./exec.js";

export interface Migration {
  id: "ai-sdk-v7" | "zod-v4" | "express-v5";
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
  \`.nullish()\` or a transform behaves differently; \`.default()\` on an object schema no longer parses
  the default, so the object's own field defaults are lost (\`.prefault()\` keeps Zod 3 behavior);
  \`string().uuid()\` rejects non-RFC UUIDs; a \`z.record\` with enum or literal keys requires every key,
  where Zod 3 allowed missing ones (\`z.partialRecord()\` keeps Zod 3 behavior; both versions reject
  unknown keys); a one-argument \`z.record(value)\` needs a key schema; a \`z.unknown()\`/\`z.any()\`
  object field is non-optional; and \`ZodError.errors\` is \`.issues\`. Zod 3 internals (\`_def.typeName\`)
  became Zod 4's (\`_def.type\`, \`_def.element\`). A behavior-preserving fix for one of these is not a
  behavior change and is not a reason to reject.
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

/** The Express 4 -> 5 fixer's rules, word for word. Behavior-preserving; no AI SDK words. */
const EXPRESS_FIXER_RULES = `Rules:
- Preserve the program's Express 4 runtime behavior exactly: the same requests must match the same
  routes, read the same params/query/body, and produce the same responses. Known Express 5 changes
  and their behavior-preserving fixes:
  - A wildcard route (\`*\`, \`/*\`, \`/x/*\`, \`/(.*)\`) throws at registration in Express 5; use a
    named splat (\`'*splat'\`, \`'/{*splat}'\`) and read \`req.params.splat.join('/')\` instead of the
    old \`req.params[0]\` string. Keep the matched paths identical (add a leading \`/\` for the
    \`*\`/\`/(.*)\` forms).
  - An optional param (\`'/user/:id?/edit'\`) throws; register two routes (\`'/user/edit'\` and
    \`'/user/:id/edit'\`) with the same handler so the matched set is unchanged.
  - A regex-constrained param (\`':id(\\d+)'\`) throws; use a plain \`':id'\` and enforce the
    constraint in the handler, preserving the capture.
  - The default query parser changed from 'extended' to 'simple'; if the app relies on nested or
    array query keys, add \`app.set('query parser', 'extended')\` near app creation.
  - \`res.redirect('back')\` now means the literal string 'back' (an open-redirect); use
    \`req.get('Referer') || '/'\` (the header is spelled Referer).
  - \`res.status(<non-integer>)\`, \`res.vary()\`, and \`res.clearCookie(name, { maxAge })\`
    changed; fix only where the finding says to.
- Never change a route's matched paths or its params object: the fix must preserve what matched
  before. Do not refactor a sync handler to async or vice versa.
- Make the smallest edit at each site. No refactors, no formatting changes, no new dependencies.
- The codemod's edits are in \`git diff\`. If one is wrong, revert that edit. If the codemod clobbered
  a non-Express \`.del(\` call or emitted the misspelled \`req.get("Referrer")\`, fix or revert it.
- Never silence a type error with \`as any\`, \`as unknown as\`, \`@ts-ignore\` or \`@ts-expect-error\`.
- If a site cannot be fixed safely, leave it and say why in your final message.
- Finish by running \`npx --no-install tsc --noEmit -p tsconfig.json\` if a tsconfig.json exists.`;

/** The Express reviewer's rules: reject edits that change behavior or touch unrelated code. */
const EXPRESS_REVIEWER_RULES = `Reject it if any of these is true:
- Runtime behavior changes beyond what Express 5 forces: a route's matched paths or params object
  changed, a query/body parse result changed, or a response differs, where a behavior-preserving
  fix existed. A behavior-preserving fix for one of the Express 5 changes above is not a behavior
  change and is not a reason to reject.
- An edit has nothing to do with the upgrade (refactors, renames, reformatting of untouched code).
- A type error from the upgrade is hidden with \`as unknown as\`, \`as any\`, \`@ts-ignore\`,
  \`@ts-expect-error\` or a similar cast or suppression instead of fixed.
- A test is deleted, skipped, or loosened, or an assertion changes, unless the edit only reverts a
  wrong codemod edit or is a minimal type-only change the new API requires.
- A function's signature changes, or a sync handler is refactored to async.`;

/** Stricter than the reviewer, mirroring the Zod judge: judgeRules extends reviewerRules. */
const EXPRESS_JUDGE_RULES = `${EXPRESS_REVIEWER_RULES}
- The diff leaves code that cannot compile, references names that do not exist, or renames anything
  this package exports.
- A site that cannot be fixed safely was forced anyway (a cast, a widened type, a loosened test,
  a route whose matched paths changed) instead of being left for the maintainer.`;

/** The Express 4 -> 5 migration. The agent prompts are Express-specific on purpose. */
export const EXPRESS_V5: Migration = {
  id: "express-v5",
  title: "Express 5",
  findPackages: (root) => findPackages(root, "express"),
  isOldMajor: (range) => allowsMajor(range, 4) && !allowsMajor(range, 5),
  bump: (root) => bumpExpress(root),
  codemod: runExpressCodemod,
  scan: (project, root) => {
    const ctx = scanExpressV5(project, root);
    // E9: related packages that commonly break with Express 5 (express-rate-limit, etc.).
    ctx.findings.push(...checkExpressRelatedPackages(root));
    // E10: Express 5's Node floor is 18. Check engines.node and CI against 18, on the express dep.
    ctx.findings.push(...checkPackageJsons(root, { major: 18, label: "Express 5", dep: "express" }));
    ctx.findings.push(...checkCiNodeVersions(root, ctx, { major: 18, label: "Express 5" }));
    return ctx;
  },
  applyAutoFixes,
  fixerIntro:
    "You are finishing an Express 4 -> 5 migration in this repository. Dependencies are already bumped\n" +
    "and the official codemod (@expressjs/codemod) has run. Fix only what is listed below.",
  reviewerIntro:
    "It upgrades the project from Express 4 to 5. A maintainer will merge it only if it is a pure upgrade.\n" +
    "You can read files and run only `git diff` and `git status`; other commands are denied. The build, typecheck " +
    "and tests already ran on this diff, so do not try to run them or install packages.",
  reference: "https://expressjs.com/en/guide/upgrading-to-5.html (you can't open it here; the rules above list every Express 5 change that matters)",
  fixerRules: EXPRESS_FIXER_RULES,
  reviewerRules: EXPRESS_REVIEWER_RULES,
  judgeRules: EXPRESS_JUDGE_RULES,
  prBranch: "shim/express-5",
  commitMessage: "Upgrade to Express 5",
  changesetFile: "upgrade-express-5.md",
  changesetText: "Upgrade to Express 5. Requires Node.js 18 or later.",
  statusLine: "migration: express-v5",
};

export const MIGRATIONS: Partial<Record<Migration["id"], Migration>> = {
  "ai-sdk-v7": AI_SDK_V7,
  "zod-v4": ZOD_V4,
  "express-v5": EXPRESS_V5,
};

export function getMigration(id?: Migration["id"]): Migration {
  if (id === undefined) return AI_SDK_V7;
  const m = MIGRATIONS[id];
  if (!m) throw new Error(`unknown migration "${id}"; known: ${Object.keys(MIGRATIONS).join(", ")}`);
  return m;
}