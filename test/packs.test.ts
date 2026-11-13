import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getMigration, type Migration } from "../src/migrations.js";
import { scanWith } from "../src/scan.js";
import { PACKS } from "../src/packs.js";

const root = path.join(import.meta.dirname, "..");
const fx = (n: string) => path.join(import.meta.dirname, "fixtures", n);
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

/**
 * Which fixture each pack's migration scans, and which scanner source files back that
 * pack's scan path. src/scan.ts is shared: its node-22 / ci-node-version / express-node-floor
 * hooks are the two package.json/CI additions each of the ai and express entries in
 * src/migrations.ts appends, so both packs list it (zod's scan is rule-file only).
 */
const PACK_SOURCES: Record<string, { fixture: string; sources: string[]; migration: Migration["id"] }> = {
  "ai-sdk-v7": { fixture: "v6-app", sources: ["src/rules/ai-sdk-v7.ts", "src/scan.ts"], migration: "ai-sdk-v7" },
  "zod-v4": { fixture: "zod3-app", sources: ["src/rules/zod-v4.ts"], migration: "zod-v4" },
  "express-v5": { fixture: "express4-app", sources: ["src/rules/express-v5.ts", "src/scan.ts"], migration: "express-v5" },
};

/**
 * Check (a') — the rule ids a pack's scanner source CAN emit: every hyphenated string literal on an
 * emission line (`add(` / `addAt(` / `ruleId:` / `const …ruleId =`) in the pack's own rule file.
 * Emission lines are where a rule id is produced, so module/dependency names ("body-parser",
 * "express-rate-limit", "ts-morph") never sit on one and are excluded for free. The shared
 * src/scan.ts hooks are attributed per pack (SHARED_HOOKS) rather than extracted, because one line
 * in it emits both the ai and the express node-floor flavors.
 */
const HY = /"([a-z][a-z0-9]*(?:-[a-z0-9]+)+)"/g;
const EMIT_LINE = /\badd(?:At)?\s*\(|\bruleId\s*:|\bconst\s+\w*ruleId\s*=/;
function emittedRuleIds(file: string): Set<string> {
  const out = new Set<string>();
  for (const line of read(file).split("\n")) {
    if (!EMIT_LINE.test(line)) continue;
    for (const m of line.matchAll(HY)) out.add(m[1]!);
  }
  return out;
}
const OWN_RULE_FILE: Record<string, string> = {
  "ai-sdk-v7": "src/rules/ai-sdk-v7.ts",
  "zod-v4": "src/rules/zod-v4.ts",
  "express-v5": "src/rules/express-v5.ts",
};
const SHARED_HOOKS: Record<string, string[]> = {
  "ai-sdk-v7": ["node-22", "ci-node-version"],
  "zod-v4": [],
  "express-v5": ["express-node-floor", "ci-node-version"],
};

describe("pack manifests", () => {
  // (a) Every rule id the scanners actually emit on their fixture has a manifest entry.
  // This is the negative control: delete a manifest entry for a rule that fires, and the
  // emitted set below now contains an id that is no longer listed, so this fails.
  for (const [id, cfg] of Object.entries(PACK_SOURCES)) {
    it(`${id}: every emitted rule id has a manifest entry`, () => {
      const { result } = scanWith(fx(cfg.fixture), getMigration(cfg.migration));
      const inManifest = new Set(PACKS[id]!.rules.map((r) => r.id));
      const missing = [...new Set(result.findings.map((f) => f.ruleId))].filter((r) => !inManifest.has(r));
      expect(missing).toEqual([]);
    });
  }

  // (a') Every rule id the scanner source CAN emit has a manifest entry — the static half of (a).
  // (a) only proves it for ids that fire on the fixture; this proves it for ids that can emit but
  // have no fixture case (express-query today). The manifest's rule-id set therefore exactly matches
  // the source's emittable set, so a new rule added in code but not declared in the manifest fails.
  for (const id of Object.keys(PACK_SOURCES)) {
    it(`${id}: every emittable rule id has a manifest entry`, () => {
      const emittable = new Set([...emittedRuleIds(OWN_RULE_FILE[id]!), ...SHARED_HOOKS[id]!]);
      const inManifest = new Set(PACKS[id]!.rules.map((r) => r.id));
      const missing = [...emittable].filter((r) => !inManifest.has(r));
      expect(missing).toEqual([]);
    });
  }

  // (b) Every manifest rule id points at code that emits it (the rule-id literal is present in
  // the pack's scanner source). A phantom manifest entry with no emitting rule fails here. The
  // two documented gap rules (express-query, the floor-18 ci-node-version flavor) still pass:
  // their emitting code exists — they just have no fixture case.
  for (const [id, cfg] of Object.entries(PACK_SOURCES)) {
    it(`${id}: every manifest rule id has emitting code`, () => {
      const src = cfg.sources.map(read).join("\n");
      const noCode = PACKS[id]!.rules.filter((r) => !src.includes(`"${r.id}"`)).map((r) => r.id);
      expect(noCode).toEqual([]);
    });
  }

  // (c) Every fixture path a manifest lists (on either side of the flag/noFlag split) exists on disk
  // — no invented paths. A path a pack does not exercise is simply absent from both lists.
  for (const id of Object.keys(PACKS)) {
    it(`${id}: every listed fixture path exists`, () => {
      const bad = PACKS[id]!.rules.flatMap((r) => [...r.flag, ...r.noFlag]).filter((f) => !fs.existsSync(path.join(root, f)));
      expect(bad).toEqual([]);
    });
  }
});
