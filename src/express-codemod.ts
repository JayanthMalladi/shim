import path from "node:path";
import { run, runCapture } from "./exec.js";
import type { Finding } from "./types.js";

/**
 * The official Express v4 -> v5 codemod, pinned: a new release must be re-checked on
 * test/fixtures/express4-app first. 0.0.5 is the only version that ships all four transforms
 * below; only 0.0.1-0.0.5 have ever been published.
 */
export const EXPRESS_CODEMOD = "@expressjs/codemod@0.0.5";

/**
 * The four transforms in the order the codemod's own `upgrade` runs them. We run them individually
 * (not `upgrade`): `upgrade` hard-codes in-place writing and cannot be previewed, and running each
 * slug separately lets Shim keep/drop a domain and scope the guard on the v4-deprecated-signatures
 * clobber (see expressCodemodGuard).
 */
const EXPRESS_TRANSFORMS = ["magic-redirect", "pluralized-methods", "v4-deprecated-signatures", "req-param"];

/**
 * Run every Express transform over the repo. True only if it ran at least once and every run
 * succeeded. Runs `npx` without `-d` so the rewrites are applied in place.
 */
export function runExpressCodemod(dir: string): boolean {
  return EXPRESS_TRANSFORMS.map((slug) => run("npx", ["-y", EXPRESS_CODEMOD, slug, "."], dir, 10 * 60_000).ok).every(Boolean);
}

/**
 * The codemod's prettier pass also rewrites files that never import express (parens around `await`,
 * stray semicolons) — style churn, not an upgrade. Like zodCodemodGuard, restore every file the
 * codemod changed that has no `express` import or require in its committed text: it is not part of
 * this PR. runCapture (not run): run keeps only the tail, which could cut the import off a long file.
 * Returns the list of files restored.
 */
export function expressCodemodUnexpressRestore(dir: string): string[] {
  const log = (msg: string) => console.error(`[shim] ${msg}`);
  const CODE_FILE = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs|vue)$/;
  // A committed file "uses express" when it carries the exact "express" module specifier (import or
  // require). ["']express["'] is not fooled by "express-rate-limit" or "@expressjs/codemod".
  const USES_EXPRESS = /["']express["']/;
  const changed = runCapture("git", ["diff", "--name-only"], dir).stdout.split("\n").map((f) => f.trim()).filter((f) => CODE_FILE.test(f));
  const restored: string[] = [];
  for (const file of changed) {
    const original = runCapture("git", ["show", `HEAD:${file}`], dir);
    if (!original.ok) continue; // not in HEAD: nothing to restore to
    if (USES_EXPRESS.test(original.stdout)) continue; // the file's committed text uses express: keep the codemod's edits
    run("git", ["checkout", "--", file], dir);
    restored.push(file);
    log(`express codemod: restored ${file} (no express import; style churn only)`);
  }
  return restored;
}

/**
 * The official codemod gets two things wrong (verified against @expressjs/codemod@0.0.5, see
 * C-tooling.md in the catalog):
 *  1. `magic-redirect` rewrites `res.redirect('back')`/`res.location('back')` to
 *     `req.get("Referrer") || "/"` — but the HTTP header is spelled `Referer` (the classic
 *     misspelling browsers send). `req.get("Referrer")` reads a header no browser ever sets, so
 *     the redirect always falls back to "/".
 *  2. `v4-deprecated-signatures` rewrites ANY `.del(` to `.delete(` whose first argument is a
 *     string/number/RegExp, regardless of receiver — a `cache.del(` / `myObj.del(` in the same file
 *     gets clobbered to `.delete(`.
 *
 * Both are reported, not auto-fixed: the correct `Referer` spelling and the clobbered `.del`
 * call are judgment calls for the maintainer, and a wrong auto-revert is worse than a flagged line.
 */
/**
 * The guard reports (never auto-fixes) the two rewrites the official codemod gets wrong, scanning
 * the diff it just produced. Track, per file, the receivers whose `.del(` the codemod removed, so
 * a `.delete(` added on a non-Express receiver that had a matching `.del(` removed is a clobber.
 */
export function expressCodemodGuard(dir: string): Finding[] {
  const findings: Finding[] = [];
  const diff = runCapture("git", ["diff", "--unified=0", "--no-color", "--no-ext-diff"], dir).stdout;
  // Receiver that is obviously an Express app/router (or a capitalized `*Router`): the `.del` ->
  // `.delete` rewrite there is correct, so only flag when the receiver is NOT one of these.
  const isExpressReceiver = (r: string) => r === "app" || r === "router" || /^express$/.test(r) || /^[A-Z]\w*Router$/.test(r) || /^[a-z]\w*Router$/.test(r);

  for (const section of diff.split(/^(?=diff --git )/m)) {
    const header = section.match(/^diff --git a\/(\S+) /)?.[1];
    if (!header) continue;
    const rel = header.split(path.sep).join("/");
    const removedDels = new Set<string>(); // receiver names whose .del( was removed in this file
    let newLine = 0;
    for (const line of section.split("\n")) {
      const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) {
        newLine = Number(hunk[1]) - 1;
        continue;
      }
      if (line[0] === "-") {
        const m = line.slice(1).match(/\b([A-Za-z_$][\w$]*)\.del\(/);
        if (m && m[1]) removedDels.add(m[1]);
      } else if (line[0] === "+") {
        newLine++;
        const body = line.slice(1);
        // 1. The codemod's misspelled Referrer header (browsers send "Referer").
        if (/req\.get\((["'])Referrer\1\)/.test(body)) {
          findings.push({
            ruleId: "express-codemod-referrer", severity: "silent", fix: "manual", file: rel,
            line: newLine, snippet: body.slice(0, 160),
            message: "The codemod rewrote a 'back' redirect to req.get(\"Referrer\"); the HTTP header is spelled Referer. " +
              "Use req.get('Referer') || '/' or keep 'back' per your intent.",
          });
          continue;
        }
        // 2. A .delete( the codemod added on a receiver that is not an Express app/router, where a
        //    matching .del( was removed in the same file: the context-blind clobber.
        const dm = body.match(/\b([A-Za-z_$][\w$]*)\.delete\(/);
        if (dm && dm[1] && !isExpressReceiver(dm[1]) && removedDels.has(dm[1])) {
          findings.push({
            ruleId: "express-codemod-del-clobber", severity: "silent", fix: "manual", file: rel,
            line: newLine, snippet: body.slice(0, 160),
            message: "The codemod rewrote a .del( call to .delete( on a receiver that is not an Express app or router. " +
              "Verify it was not a cache/object API that means 'remove'.",
          });
        }
      }
    }
  }
  return findings;
}
