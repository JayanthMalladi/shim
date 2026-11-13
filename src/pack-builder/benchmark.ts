/**
 * S06: the benchmark scorer (the kill test). Runs a generated candidate pack against the real
 * pack's fixtures and scores it two ways:
 *
 *   RECALL     — for each of the real pack's silent + break rules, is every line that the real
 *                scanner flags on the fixture also flagged by a candidate rule (same file:line)?
 *                "Caught" means the candidate reproduces that rule's findings. The stop rule is
 *                recall < 5 of the real Zod rules.
 *   FALSE FLAGS — candidate findings on lines the real scanner does NOT flag (the fixture's
 *                must-NOT-flag lines; the real scanner's output is exactly the flag set). Stop
 *                rule: false flags > 2.
 *
 * The scorer is model-free and target-repo-free: it interprets the candidate's rules.json through
 * the fixed DSL interpreter and runs the real migration's scanner as ground truth. Run from the
 * real repo so the ground truth (src/rules/zod-v4.ts + test/fixtures/zod3-app) is present; the
 * candidate itself was generated in a *blind* copy where both were deleted.
 */
import fs from "node:fs";
import path from "node:path";
import { Project } from "ts-morph";
import { getMigration } from "../migrations.js";
import { scanWith } from "../scan.js";
import { interpretRule } from "./interpret.js";
import type { DslRule } from "./types.js";
import type { Finding } from "../types.js";

const key = (f: { file: string; line: number }) => `${f.file}:${f.line}`;

/** The real migration's findings on a fixture dir — the ground truth. */
export function realFindings(fixtureDir: string, migration: Parameters<typeof getMigration>[0]): Finding[] {
  const { result } = scanWith(fixtureDir, getMigration(migration));
  return result.findings;
}

/** Load a candidate pack's DSL rules (rules.json) and interpret them against a fixture dir. */
export function candidateFindings(candidateOutDir: string, fixtureDir: string): Finding[] {
  const rulesFile = path.join(candidateOutDir, "rules.json");
  const rules: DslRule[] = fs.existsSync(rulesFile) ? JSON.parse(fs.readFileSync(rulesFile, "utf8")) : [];
  if (rules.length === 0) return [];
  const abs = path.resolve(fixtureDir);
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true, jsx: 4 },
  });
  const { sourceFiles } = walkSource(abs);
  for (const f of sourceFiles) project.addSourceFileAtPath(f);
  const out: Finding[] = [];
  for (const r of rules) {
    const ctx = interpretRule(r, project, abs);
    for (const f of ctx.findings) out.push(f);
  }
  return out;
}

/** A real rule is "caught" when every line it flags is flagged by some candidate rule. */
export interface RuleScore {
  ruleId: string;
  realLines: number;
  caughtLines: number;
  caught: boolean;
}
export interface BenchmarkScore {
  realRules: number;
  caught: number;
  recall: number; // caught / realRules
  falseFlags: number;
  perRule: RuleScore[];
  /** The stop-rule verdicts: the positioning is "hand-built packs + agent floor" when either fails. */
  belowRecallFloor: boolean;
  aboveFpCeiling: boolean;
}

/** Score a candidate's findings against the real pack's silent + break rules on one fixture dir. */
export function score(fixtureDir: string, migration: Parameters<typeof getMigration>[0], candidateOutDir: string): BenchmarkScore {
  const real = realFindings(fixtureDir, migration);
  const cand = candidateFindings(candidateOutDir, fixtureDir);
  // Ground-truth flag set (the real scanner's findings) — a candidate finding outside it is a false flag.
  const realKeys = new Set(real.map(key));
  const candKeys = new Set(cand.map(key));
  const candOnKey = new Map<string, Set<string>>(); // "file:line" -> ruleIds that fired there
  for (const f of cand) {
    const k = key(f);
    if (!candOnKey.has(k)) candOnKey.set(k, new Set());
    candOnKey.get(k)!.add(f.ruleId);
  }

  // Group the real findings by rule, keeping only silent + break (the benchmark's scope).
  const byRule = new Map<string, Set<string>>();
  for (const f of real) {
    if (f.severity !== "silent" && f.severity !== "break") continue;
    if (!byRule.has(f.ruleId)) byRule.set(f.ruleId, new Set());
    byRule.get(f.ruleId)!.add(key(f));
  }
  const perRule: RuleScore[] = [];
  let caught = 0;
  for (const [ruleId, lines] of [...byRule.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const caughtLines = [...lines].filter((k) => candKeys.has(k)).length;
    const isCaught = caughtLines === lines.size;
    if (isCaught) caught++;
    perRule.push({ ruleId, realLines: lines.size, caughtLines, caught: isCaught });
  }
  const realRules = byRule.size;
  const falseFlags = [...candKeys].filter((k) => !realKeys.has(k)).length;

  return {
    realRules,
    caught,
    recall: realRules ? caught / realRules : 0,
    falseFlags,
    perRule,
    belowRecallFloor: realRules > 0 && caught < 5,
    aboveFpCeiling: falseFlags > 2,
  };
}

/** The BENCHMARK.md body: one row per real rule (caught yes/no) plus the false-flag count. */
export function renderBenchmark(s: BenchmarkScore): string {
  const L: string[] = [
    "| real rule | real lines | caught lines | caught |",
    "|---|---|---|---|",
  ];
  for (const r of s.perRule) L.push(`| ${r.ruleId} | ${r.realLines} | ${r.caughtLines} | ${r.caught ? "yes" : "no"} |`);
  L.push("");
  L.push(`**Recall: ${s.caught}/${s.realRules}** (floor 5). **False flags: ${s.falseFlags}** (ceiling 2).`);
  const stop = s.belowRecallFloor || s.aboveFpCeiling;
  L.push(
    stop
      ? "\nSTOP RULE MET — position Shim as hand-built packs plus the agent floor; do not claim \"general\"."
      : "\nKill test passed — the generated pack reproduces the real Zod pack within the recall/FP bounds."
  );
  return L.join("\n");
}

/** Recursively collect the source files the interpreter should see, skipping built dirs. */
function walkSource(dir: string): { sourceFiles: string[] } {
  const out: string[] = [];
  const skip = new Set(["node_modules", "dist", "build", ".next", ".turbo", "out", "coverage", ".git"]);
  const rec = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name)) rec(p);
      } else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(e.name) && !e.name.endsWith(".d.ts")) {
        out.push(p);
      }
    }
  };
  rec(dir);
  return { sourceFiles: out };
}

/**
 * Standalone: `npx tsx src/pack-builder/benchmark.ts <migration> <fixtureDir> <candidateOutDir> [--out file]`.
 * Scores the blind-generated candidate (its rules.json) against the real pack's scanner on the same
 * fixture and prints the BENCHMARK.md table. Run from the REAL repo so the ground truth is present.
 */
function main(argv: string[]): void {
  const [mig, fixture, candOut, ...rest] = argv;
  if (!mig || !fixture || !candOut) {
    console.error("usage: tsx src/pack-builder/benchmark.ts <migration> <fixtureDir> <candidateOutDir> [--out file]");
    process.exit(1);
  }
  const s = score(path.resolve(fixture), mig as Parameters<typeof getMigration>[0], path.resolve(candOut));
  const table = renderBenchmark(s);
  console.log(table);
  const outI = rest.indexOf("--out");
  if (outI >= 0 && rest[outI + 1]) fs.writeFileSync(path.resolve(rest[outI + 1]!), table + "\n", "utf8");
}
// Only when run directly (not imported by a test / by build.ts).
if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join("pack-builder", "benchmark.ts"))) main(process.argv.slice(2));

