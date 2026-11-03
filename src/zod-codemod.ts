import fs from "node:fs";
import path from "node:path";
import { run } from "./exec.js";
import { findPackages } from "./scan.js";
import type { Finding } from "./types.js";

const log = (msg: string) => console.error(`[shim] ${msg}`);

/** The community codemod, pinned: a new release must be re-checked on test/fixtures/zod3-app first. */
export const ZOD_CODEMOD = "zod-v3-to-v4@1.22.2";

/**
 * Run the codemod once per distinct tsconfig.json next to a package.json that uses zod.
 * True only if it ran at least once and every run succeeded.
 */
export function runZodCodemod(dir: string): boolean {
  const tsconfigs = [...new Set(findPackages(dir, "zod").map((p) => path.join(path.dirname(p.file), "tsconfig.json")))]
    .filter((f) => fs.existsSync(f))
    .map((f) => path.relative(dir, f).split(path.sep).join("/"));
  if (!tsconfigs.length) {
    log("zod codemod: no tsconfig.json next to a zod package, skipped");
    return false;
  }
  return tsconfigs.map((t) => run("npx", ["-y", ZOD_CODEMOD, t, "-y"], dir, 10 * 60_000).ok).every(Boolean);
}

const CODE_FILE = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs|vue)$/;
const EXACT_ZOD = /(from\s*|require\(\s*|import\(\s*)["']zod["']/;
const ZOD_V3 = /["']zod\/v3["']/;

/**
 * Undo codemod edits Shim can't stand behind. A changed file whose committed text has no import
 * from exactly "zod" (only "zod/v3", "zod/v4", or none) is reverted: "zod/v3" code keeps Zod 3
 * behavior after the bump, and the codemod rewrites it to "zod". A file that imports both "zod" and
 * "zod/v3" and lost a "zod/v3" import is reverted too, and reported, because Shim's own rewrites
 * in it go with the revert.
 */
export function zodCodemodGuard(dir: string): Finding[] {
  const findings: Finding[] = [];
  const changed = run("git", ["diff", "--name-only"], dir).output.split("\n").map((f) => f.trim()).filter((f) => CODE_FILE.test(f));
  for (const file of changed) {
    const original = run("git", ["show", `HEAD:${file}`], dir);
    if (!original.ok) continue; // not in HEAD: nothing to revert to
    const removedV3 = run("git", ["diff", "--", file], dir).output.split("\n").some((l) => l.startsWith("-") && ZOD_V3.test(l));
    const exact = EXACT_ZOD.test(original.output);
    if (exact && !removedV3) continue;
    run("git", ["checkout", "--", file], dir);
    log(`zod codemod guard: reverted ${file}`);
    if (exact) {
      findings.push({
        ruleId: "codemod-touched-unrelated", severity: "silent", fix: "manual", file, line: 1, snippet: "",
        message: 'This file imports from both "zod" and "zod/v3". The codemod rewrote the "zod/v3" import, so this PR leaves the file unchanged. Its "zod" schemas still need the Zod 4 review.',
      });
    }
  }
  return findings;
}
