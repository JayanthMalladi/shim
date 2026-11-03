import type { Project } from "ts-morph";
import type { RuleContext } from "./rules/ai-sdk-v7.js";
import { checkCiNodeVersions, checkPackageJsons, findAiPackages } from "./scan.js";
import { scanAiSdkV7 } from "./rules/ai-sdk-v7.js";
import { bumpAiSdk } from "./bump.js";
import { applyAutoFixes } from "./rules/ai-sdk-v7.js";
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

export const MIGRATIONS: Partial<Record<Migration["id"], Migration>> = { "ai-sdk-v7": AI_SDK_V7 };

export function getMigration(id?: Migration["id"]): Migration {
  if (id === undefined) return AI_SDK_V7;
  const m = MIGRATIONS[id];
  if (!m) throw new Error(`unknown migration "${id}"; known: ${Object.keys(MIGRATIONS).join(", ")}`);
  return m;
}