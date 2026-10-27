import fs from "node:fs";
import path from "node:path";
import { runFixer } from "./agent.js";
import { bumpAiSdk } from "./bump.js";
import { run } from "./exec.js";
import { detectPackageManager, hasValidation, readPkg, regressions, runGates, type GateName, type GateResults } from "./gates.js";
import { prBody } from "./pr-body.js";
import { findAiPackages, scan, scanAndFix } from "./scan.js";
import type { Finding } from "./types.js";

export interface MigrateOptions {
  /** Run the fixer agent on findings Shim can't fix deterministically. */
  agent: boolean;
  /** Where to write report.json and pr-body.md. */
  outDir: string;
}

export type Verdict = "open-pr" | "open-issue" | "skip";

export interface MigrationReport {
  repo: string;
  verdict: Verdict;
  reason: string;
  versionChanges: string[];
  /** A published package: after this PR its users need AI SDK 7 too, so it ships as a major. */
  library: boolean;
  codemod: boolean;
  autoFixed: number;
  before: Finding[];
  remaining: Finding[];
  baseline: Record<string, boolean>;
  after: Record<string, boolean>;
  regressions: GateName[];
  /** Output tail of each regressed gate, for the issue body and for debugging. */
  failures: Record<GateName, string>;
  diffStat: string;
}

const gateSummary = (g: GateResults) =>
  Object.fromEntries(Object.entries(g).map(([k, v]) => [k, !!v?.ok]));

export async function migrate(dir: string, repo: string, opts: MigrateOptions): Promise<MigrationReport> {
  const log = (msg: string) => console.error(`[shim] ${msg}`);
  const base = { repo, versionChanges: [], library: false, codemod: false, autoFixed: 0, before: [], remaining: [], baseline: {}, after: {}, regressions: [], failures: {}, diffStat: "" };

  const aiPkgs = findAiPackages(dir);
  if (!aiPkgs.some((p) => /(^|[\^~>=\s])6(\.|$)/.test(p.range))) {
    return { ...base, verdict: "skip", reason: `not on ai@6 (${aiPkgs.map((p) => p.range).join(", ") || "no ai dependency"})` };
  }
  const pm = detectPackageManager(dir);
  const pkgDirs = aiPkgs.map((p) => path.dirname(p.file));
  const library = pkgDirs.some((d) => {
    const pkg = readPkg(d);
    return !!pkg?.name && !pkg.private;
  });

  log(`baseline gates (${pm})`);
  const baseline = runGates(dir, pm, true, pkgDirs);
  if (!baseline.install?.ok) {
    return { ...base, verdict: "skip", reason: "baseline install fails", baseline: gateSummary(baseline) };
  }
  log("bumping dependencies");
  const versionChanges = bumpAiSdk(dir);

  log("running official codemod");
  const codemod = run("npx", ["-y", "@ai-sdk/codemod@4", "v7", "."], dir).ok;

  // One scan of the codemodded v6 code. Its silent findings can't be re-detected later:
  // once fixed, `result.usage` is valid v7 code that means something else.
  log("applying Shim auto-fixes");
  const { result: pre, applied } = await scanAndFix(dir);
  const forAgent = pre.findings.filter((f) => f.fix === "agent");
  const postBreaks = () => scan(dir).result.findings.filter((f) => f.severity === "break" && f.fix !== "manual");

  let after = runGates(dir, pm, false, pkgDirs);
  let remaining = dedupe([...forAgent, ...postBreaks()]);

  if (opts.agent && (remaining.length > 0 || regressions(baseline, after).length > 0)) {
    log(`fixer agent on ${remaining.length} findings`);
    runFixer(dir, remaining, Object.entries(after).filter(([g, r]) => g.startsWith("typecheck") && !r.ok).map(([g, r]) => `${g}:\n${r.output}`).join("\n"));
    after = runGates(dir, pm, false, pkgDirs);
    // Silent findings handed to the agent are verified by the gates and by review, not by re-scanning.
    remaining = postBreaks();
  }
  const before = pre.findings;

  const regressed = regressions(baseline, after);
  const unresolvedBreaks = remaining.filter((f) => f.severity !== "deprecated");
  const diffStat = run("git", ["diff", "--stat"], dir).output.trim();

  let verdict: Verdict = "open-pr";
  let reason = "all baseline gates still pass and no breaking findings remain";
  if (regressed.length) [verdict, reason] = ["open-issue", `gates regressed: ${regressed.join(", ")}`];
  else if (unresolvedBreaks.length) [verdict, reason] = ["open-issue", `${unresolvedBreaks.length} findings need a human`];
  else if (!hasValidation(baseline)) [verdict, reason] = ["open-issue", "no green typecheck or tests to validate against"];

  const report: MigrationReport = {
    repo, verdict, reason, versionChanges, library, codemod, autoFixed: applied,
    before, remaining, baseline: gateSummary(baseline), after: gateSummary(after), regressions: regressed, diffStat,
    failures: Object.fromEntries(regressed.map((g) => [g, after[g]?.output.slice(-1500) ?? ""])),
  };
  fs.mkdirSync(opts.outDir, { recursive: true });
  fs.writeFileSync(path.join(opts.outDir, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(opts.outDir, "pr-body.md"), prBody(report));
  return report;
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.ruleId}:${f.file}:${f.line}`;
    return !seen.has(key) && !!seen.add(key);
  });
}
