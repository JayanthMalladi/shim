import fs from "node:fs";
import path from "node:path";
import { run, runCapture } from "./exec.js";
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
  // runCapture, not run: run keeps only the last 8000 characters, which cuts the import off a long file.
  const changed = runCapture("git", ["diff", "--name-only"], dir).stdout.split("\n").map((f) => f.trim()).filter((f) => CODE_FILE.test(f));
  for (const file of changed) {
    const original = runCapture("git", ["show", `HEAD:${file}`], dir);
    if (!original.ok) continue; // not in HEAD: nothing to revert to
    const removedV3 = runCapture("git", ["diff", "--", file], dir).stdout.split("\n").some((l) => l.startsWith("-") && ZOD_V3.test(l));
    const exact = EXACT_ZOD.test(original.stdout);
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

/** Codemod rewrites that act the same on Zod 4 and only add diff lines: the codemod's text, then Zod 3's. */
const COSMETIC: [RegExp, string][] = [[/\bz\.int\(\)/g, "z.number().int()"]];
const squash = (lines: string[]) => lines.map((l) => l.slice(1)).join("").replace(/\s+/g, "");

/**
 * Undo the codemod's cosmetic hunks (see COSMETIC). A hunk is undone only when its added lines,
 * with the rewrite mapped back, equal its removed lines up to whitespace, so a hunk that also holds
 * a real change is kept whole. Returns the number of hunks undone.
 */
export function undoCosmeticCodemodEdits(dir: string): number {
  const diff = runCapture("git", ["diff", "-U0", "--no-color", "--no-ext-diff"], dir).stdout;
  const patch: string[] = [];
  let undone = 0;
  for (const section of diff.split(/^(?=diff --git )/m)) {
    const parts = section.split(/^(?=@@ )/m);
    const header = parts.shift() ?? "";
    if (!CODE_FILE.test(header.split("\n")[0] ?? "")) continue;
    const hunks = parts.filter((hunk) => {
      const lines = hunk.split("\n").slice(1);
      const removed = lines.filter((l) => l.startsWith("-"));
      const added = lines.filter((l) => l.startsWith("+"));
      const mapped = COSMETIC.reduce((s, [re, to]) => s.replace(re, to), squash(added));
      return mapped !== squash(added) && mapped === squash(removed);
    });
    if (!hunks.length) continue;
    patch.push(header, ...hunks);
    undone += hunks.length;
  }
  if (!undone) return 0;
  const ok = runCapture("git", ["apply", "-R", "--unidiff-zero", "-"], dir, patch.join("")).ok;
  if (!ok) {
    log("zod codemod: could not undo cosmetic edits, kept them");
    return 0;
  }
  log(`zod codemod: undid ${undone} cosmetic edit(s)`);
  return undone;
}
