import type { PackManifest } from "./types.js";
import { aiSdkV7 } from "./packs/ai-sdk-v7/manifest.js";
import { zodV4 } from "./packs/zod-v4/manifest.js";
import { expressV5 } from "./packs/express-v5/manifest.js";

export { aiSdkV7, zodV4, expressV5 };

/**
 * S05: the pack registry. One `PackManifest` per migration in `MIGRATIONS`
 * (src/migrations.ts). The manifests are descriptive — the scanners keep producing
 * byte-identical findings — but `exposure.ts` and `migrations.ts` read the `package`
 * and major ranges from here instead of their own mirrors, and `test/packs.test.ts`
 * proves the `rules` agree with what each scanner actually emits.
 */
export const PACKS: Record<string, PackManifest> = {
  "ai-sdk-v7": aiSdkV7,
  "zod-v4": zodV4,
  "express-v5": expressV5,
};

/** The manifest for a migration id (the keys of `MIGRATIONS`), or undefined. */
export function getPack(id: string): PackManifest | undefined {
  return PACKS[id];
}

/**
 * The generated `docs/PACKS.md` table: one row per rule, so the doc can't drift from the
 * code. Also what `npx tsx src/cli.ts packs` prints.
 */
export function renderPacksTable(): string {
  // Escape a literal `|` so it can't split a markdown-table column (e.g. clearCookie's `{ maxAge | expires }`).
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  const lines = [
    "# Shim packs",
    "",
    "The maintained record of every pack's rules — one row per rule id each scanner emits. Generated from",
    "`src/packs/`; `npx tsx src/cli.ts packs` prints this same table, so it can't drift from the code.",
    "",
    "| package | range | rule id | severity | change | source |",
    "|---|---|---|---|---|---|",
  ];
  for (const p of Object.values(PACKS)) {
    for (const r of p.rules) {
      lines.push(
        `| ${p.package} | ${cell(`${p.from} -> ${p.to}`)} | ${r.id} | ${r.severity} | ${cell(r.change)} | ${cell(r.source)} |`
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}
