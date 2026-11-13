/**
 * S06 step 5: the candidate pack output. Writes a self-contained pack dir under `--out` (never
 * into src/packs/): a manifest in the S05 PackManifest shape, a rules module that runs the shipped
 * DSL rules through the fixed interpreter, the candidate fixtures, and a build-report.md. Jayanth
 * copies a pack into src/packs/<id>/ only after review; until then it is a candidate and is not
 * registered in src/packs.ts.
 */
import fs from "node:fs";
import path from "node:path";
import type { PackManifest } from "../types.js";
import type { Candidate, BuildReport, DslRule } from "./types.js";
import { genFlagName, genNoFlagName } from "./harness.js";

/** The candidate pack's manifest, in the S05 PackManifest shape the registry expects. */
export function emitManifest(opts: { id: string; package: string; from: string; to: string; rules: Candidate[] }): PackManifest {
  return {
    id: opts.id,
    package: opts.package,
    from: opts.from,
    to: opts.to,
    rules: opts.rules.map((c) => ({
      id: c.rule.id,
      severity: c.rule.emit.severity,
      fix: c.rule.emit.fix,
      change: c.evidence,
      source: c.evidence,
      flag: [genFlagName(c.rule.id)],
      noFlag: [genNoFlagName(c.rule.id)],
    })),
  };
}

/** A standalone .ts that exports the manifest as a PackManifest. */
export function manifestTs(m: PackManifest): string {
  return [
    `import type { PackManifest } from "../../types.js";`,
    "",
    `/** S06 candidate pack ${m.id} — generated from public evidence. Not registered; copy into src/packs/${m.id}/ after review. */`,
    `export const pack = `,
    JSON.stringify(m, null, 2).replace(/\n/g, "\n"),
    ` as PackManifest;`,
    "",
  ].join("");
}

/**
 * The rules module: the shipped DSL rules plus a scan that runs them through the fixed interpreter.
 * This is the "rule code" a generated pack points at — declarative rules, no free-form ts-morph.
 */
export function rulesTs(rules: DslRule[], pkg: string): string {
  const body = rules.map((r) => JSON.stringify(r, null, 2)).join(",\n");
  return [
    `import type { Project } from "ts-morph";`,
    `import type { RuleContext } from "../rules/ai-sdk-v7.js";`,
    `import { interpretRule } from "../pack-builder/interpret.js";`,
    `import type { DslRule } from "../pack-builder/types.js";`,
    "",
    `const RULES: DslRule[] = [${body}];`,
    "",
    `export const RULE_IDS = RULES.map((r) => r.id);`,
    "",
    `export function scanGenerated(project: Project, root: string): RuleContext {`,
    `  const ctx: RuleContext = { root, findings: [], edits: [], fileEdits: [] };`,
    `  for (const r of RULES) { const c = interpretRule(r, project, root); ctx.findings.push(...c.findings); ctx.edits.push(...c.edits); ctx.fileEdits.push(...c.fileEdits); }`,
    `  return ctx;`,
    `}`,
    "",
  ].join("\n");
}

/** build-report.md: what the builder did, what shipped, what it skipped, and why. */
export function buildReportMd(report: BuildReport, manifest: PackManifest): string {
  const L: string[] = [
    `# Pack build report: ${report.package} ${report.from} -> ${report.to}`,
    "",
    `- Draft model: \`${report.draftModel}\`; judge model: \`${report.judgeModel}\`.`,
    `- Cost: ${report.cost == null ? "unpriced (dsh or ANTHROPIC_BASE_URL)" : `$${report.cost}`}.`,
    `- Candidates produced: ${report.candidates}. Skipped: ${report.skips.length}.`,
    `- Admitted by the harness: ${report.admitted.length ? report.admitted.join(", ") : "none"}.`,
    `- Shipped (admitted + judged in): ${report.shipped.length ? report.shipped.join(", ") : "none"}.`,
    "",
    `## Rules in the manifest`,
    "",
  ];
  for (const r of manifest.rules) L.push(`- \`${r.id}\` (${r.severity}/${r.fix}) — ${r.change}`);
  L.push("", "## Skips (no static rule)", "");
  for (const s of report.skips) L.push(`- ${s.evidence} — ${s.reason}`);
  L.push("", "## Judge verdicts", "");
  for (const j of report.judged) L.push(`- \`${j.ruleId}\`: ${j.admit ? "ADMIT" : "REJECT"} — ${j.reason}`);
  L.push("", "_This pack is a candidate: copy into `src/packs/` and register in `src/packs.ts` after review._");
  return L.join("\n");
}

/** Write the whole candidate pack into outDir. */
export function writePack(outDir: string, manifest: PackManifest, rules: DslRule[], candidates: Candidate[], report: BuildReport): string {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, "__fixtures__"), { recursive: true });
  for (const c of candidates) {
    fs.writeFileSync(path.join(outDir, "__fixtures__", genFlagName(c.rule.id)), c.flagFixture);
    fs.writeFileSync(path.join(outDir, "__fixtures__", genNoFlagName(c.rule.id)), c.noFlagFixture);
  }
  fs.writeFileSync(path.join(outDir, "manifest.ts"), manifestTs(manifest), "utf8");
  fs.writeFileSync(path.join(outDir, "rules.ts"), rulesTs(rules, manifest.package), "utf8");
  // Machine-readable copies the benchmark scorer loads (interpret the DSL rules without importing
  // the generated .ts; the scorer ships in the blind copy, so it can't reach the real pack's rules).
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "rules.json"), JSON.stringify(rules, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "build-report.md"), buildReportMd(report, manifest), "utf8");
  return outDir;
}
