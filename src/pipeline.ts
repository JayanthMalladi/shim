import fs from "node:fs";
import path from "node:path";
import { runReviewer } from "./agent.js";
import { DEFAULT_ARCH, type Architecture } from "./arch.js";
import { bumpAiSdk } from "./bump.js";
import { codemodExportFindings } from "./codemod-guard.js";
import { adopt, fixInParallel, rank } from "./candidates.js";
import { run } from "./exec.js";
import { detectPackageManager, hasTypecheckScript, hasValidation, readPkg, regressions, runGates, type GateName, type GateResults, type PackageManager } from "./gates.js";
import { prBody } from "./pr-body.js";
import { findAiPackages, scan, scanAndFix } from "./scan.js";
import type { Finding } from "./types.js";

export interface MigrateOptions {
  /** Run the fixer agent on findings Shim can't fix deterministically. */
  agent: boolean;
  /** Where to write report.json and pr-body.md. */
  outDir: string;
  arch?: Architecture;
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
  /** Final text of each fixer-agent attempt on the chosen candidate. */
  agentRuns: string[];
  /** Every parallel fixer candidate, for tuning the fixer across the fleet. */
  candidates: { ok: boolean; size: number; regressions: GateName[]; remaining: number; approved?: boolean }[];
  /** The internal reviewer's verdict on the final diff, when the architecture has one. */
  review?: { approve: boolean; issues: string[] };
  diffStat: string;
  /** Files this PR changes; a finding counts as fixed only if its file is among them. */
  changedFiles: string[];
  /** Checks the upgrade broke that the fixer then repaired. */
  repairedChecks: GateName[];
  /** Architecture id, agent spend in USD, and wall time of the fix stage. */
  arch?: string;
  cost?: number;
  fixMs?: number;
}

/** Everything up to the fix stage. Saved to disk so architectures can be compared on the same start. */
export interface Prepared {
  repo: string;
  pm: PackageManager;
  /** Packages that use ai, relative to the repo root so a copy of the repo can reuse them. */
  pkgDirs: string[];
  library: boolean;
  baseline: GateResults;
  versionChanges: string[];
  codemod: boolean;
  applied: number;
  /** One scan of the codemodded v6 code; its silent findings can't be re-detected after fixing. */
  pre: Finding[];
  /** Gates after the codemod and Shim's deterministic fixes. */
  after: GateResults;
}

const gateSummary = (g: GateResults) =>
  Object.fromEntries(Object.entries(g).map(([k, v]) => [k, !!v?.ok]));

const log = (msg: string) => console.error(`[shim] ${msg}`);

const emptyReport = (repo: string) => ({ repo, versionChanges: [], library: false, codemod: false, autoFixed: 0, before: [], remaining: [], baseline: {}, after: {}, regressions: [], failures: {}, agentRuns: [], candidates: [], diffStat: "", changedFiles: [], repairedChecks: [] });

export async function prepare(dir: string, repo: string): Promise<{ prepared: Prepared } | { skip: string; baseline?: GateResults }> {
  const aiPkgs = findAiPackages(dir);
  if (!aiPkgs.some((p) => /(^|[\^~>=\s])6(\.|$)/.test(p.range))) {
    return { skip: `not on ai@6 (${aiPkgs.map((p) => p.range).join(", ") || "no ai dependency"})` };
  }
  const pm = detectPackageManager(dir);
  const pkgDirs = aiPkgs.map((p) => path.dirname(p.file));
  const library = pkgDirs.some((d) => {
    const pkg = readPkg(d);
    return !!pkg?.name && !pkg.private;
  });

  log(`baseline gates (${pm})`);
  const baseline = runGates(dir, pm, true, pkgDirs);
  if (!baseline.install?.ok) return { skip: "baseline install fails", baseline };

  log("bumping dependencies");
  const versionChanges = bumpAiSdk(dir);
  log("running official codemod");
  const codemod = run("npx", ["-y", "@ai-sdk/codemod@4", "v7", "."], dir).ok;
  log("applying Shim auto-fixes");
  const { result: pre, applied } = await scanAndFix(dir);
  const guard = codemodExportFindings(dir);
  const after = runGates(dir, pm, false, pkgDirs);
  return {
    prepared: {
      repo, pm, pkgDirs: pkgDirs.map((d) => path.relative(dir, d) || "."), library, baseline,
      versionChanges, codemod, applied, pre: [...pre.findings, ...guard], after,
    },
  };
}

export async function migrate(dir: string, repo: string, opts: MigrateOptions): Promise<MigrationReport> {
  const p = await prepare(dir, repo);
  if ("skip" in p) {
    const report: MigrationReport = { ...emptyReport(repo), verdict: "skip", reason: p.skip, baseline: gateSummary(p.baseline ?? {}) };
    writeReport(report, opts.outDir);
    return report;
  }
  return finish(dir, p.prepared, opts);
}

/** The fix stage: fixer candidates, review, verdict, report. Varies by architecture. */
export async function finish(dir: string, prep: Prepared, opts: MigrateOptions): Promise<MigrationReport> {
  const arch = opts.arch ?? DEFAULT_ARCH;
  const started = Date.now();
  const { repo, pm, baseline, versionChanges, library, codemod, applied } = prep;
  const pkgDirsIn = (root: string) => prep.pkgDirs.map((p) => path.join(root, p));
  const breaks = (d: string) => [
    ...scan(d).result.findings.filter((f) => f.severity === "break" && f.fix !== "manual"),
    ...codemodExportFindings(d),
  ];

  let after = prep.after;
  const brokenByUpgrade = regressions(baseline, after);
  let remaining = dedupe([...prep.pre.filter((f) => f.fix === "agent" && f.ruleId !== "codemod-renamed-export"), ...breaks(dir)]);
  const agentRuns: string[] = [];
  let candidates: MigrationReport["candidates"] = [];
  let review: MigrationReport["review"];
  let cost = 0;

  const needsFix = remaining.length > 0 || brokenByUpgrade.length > 0 || arch.audit;
  if (opts.agent && needsFix) {
    log(`${arch.id}: ${arch.candidates} candidates, ${remaining.length} findings, ${brokenByUpgrade.length} failing checks`);
    const cands = await fixInParallel(dir, arch, {
      baseline, after, findings: remaining,
      failingOutput: (a) => Object.entries(a)
        .filter(([g, r]) => g !== "install" && !r.ok && baseline[g]?.ok)
        .map(([g, r]) => `${g}:\n${r.output.slice(-3000)}`)
        .join("\n\n"),
      // Same packages, inside the candidate's copy: absolute paths would gate the original repo.
      gates: (d, install) => runGates(d, pm, false, pkgDirsIn(d), { install }),
      breaks,
      checks: Object.keys(baseline).filter((g) => g !== "install").map((g) => {
        const [kind, rel = "."] = g.split(" ");
        if (kind === "build") return `${pm} run build`;
        if (kind === "typecheck") return `cd ${rel} && ${hasTypecheckScript(path.join(dir, rel)) ? `${pm} run typecheck` : "npx --no-install tsc --noEmit -p tsconfig.json"}`;
        return `cd ${rel} && ${pm} run test`;
      }),
    });
    cost += cands.reduce((s, c) => s + c.cost, 0);
    candidates = cands.map((c) => ({ ok: c.ok, size: c.size, regressions: regressions(baseline, c.after), remaining: c.remaining.length, approved: c.review?.approve }));
    const chosen = rank(cands, baseline, arch.selection)[0]!;
    adopt(dir, chosen, cands);
    after = chosen.after;
    remaining = chosen.remaining;
    agentRuns.push(...chosen.agentRuns);
    if (chosen.review) review = { approve: chosen.review.approve, issues: chosen.review.issues };
  } else if (opts.agent && arch.review && !brokenByUpgrade.length) {
    log("reviewing diff");
    const r = await runReviewer(dir, arch.reviewerRules, arch.reviewerModel);
    cost += r.cost;
    review = { approve: r.approve, issues: r.issues };
  }
  formatChanged(dir);
  addChangeset(dir, pkgDirsIn(dir));

  const regressed = regressions(baseline, after);
  const unresolvedBreaks = remaining.filter((f) => f.severity !== "deprecated");
  const diffStat = run("git", ["diff", "--stat"], dir).output.trim();
  const changedFiles = run("git", ["diff", "--name-only"], dir).output.trim().split("\n").filter(Boolean);
  const repairedChecks = brokenByUpgrade.filter((g) => !regressed.includes(g));

  let verdict: Verdict = "open-pr";
  let reason = "all baseline gates still pass and no breaking findings remain";
  if (regressed.length) [verdict, reason] = ["open-issue", `gates regressed: ${regressed.join(", ")}`];
  else if (unresolvedBreaks.length) [verdict, reason] = ["open-issue", `${unresolvedBreaks.length} findings need a human`];
  else if (!hasValidation(baseline)) [verdict, reason] = ["open-issue", "no green typecheck or tests to validate against"];
  else if (review && !review.approve) [verdict, reason] = ["open-issue", `reviewer flagged: ${review.issues.join("; ")}`];

  const report: MigrationReport = {
    repo, verdict, reason, versionChanges, library, codemod, autoFixed: applied,
    before: prep.pre, remaining, baseline: gateSummary(baseline), after: gateSummary(after), regressions: regressed,
    diffStat, changedFiles, repairedChecks, agentRuns, candidates, review,
    failures: Object.fromEntries(regressed.map((g) => [g, after[g]?.output.slice(-1500) ?? ""])),
    arch: arch.id, cost, fixMs: Date.now() - started,
  };
  writeReport(report, opts.outDir);
  return report;
}

function writeReport(report: MigrationReport, outDir: string) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  if (report.verdict !== "skip") fs.writeFileSync(path.join(outDir, "pr-body.md"), prBody(report));
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.ruleId}:${f.file}:${f.line}`;
    return !seen.has(key) && !!seen.add(key);
  });
}

/** Run the repo's own formatter on the files we touched, so the diff matches its style. */
function formatChanged(dir: string) {
  const files = run("git", ["diff", "--name-only"], dir).output.split("\n")
    .filter((f) => /\.(m|c)?[jt]sx?$/.test(f) && fs.existsSync(path.join(dir, f)));
  if (!files.length) return;
  const pkg = readPkg(dir);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  if (deps["@biomejs/biome"]) run("npx", ["--no-install", "biome", "format", "--write", ...files], dir);
  else if (deps.prettier) run("npx", ["--no-install", "prettier", "--write", ...files], dir);
  // Codemod output uses its own quote style; the repo's lint autofix puts it back.
  if (deps.eslint) run("npx", ["--no-install", "eslint", "--fix", ...files], dir);
}

/** Repos on changesets gate releases on a .changeset file; a dropped v6 is a major for each published package. */
function addChangeset(dir: string, pkgDirs: string[]) {
  if (!fs.existsSync(path.join(dir, ".changeset", "config.json"))) return;
  const names = [...new Set(pkgDirs.map(readPkg).filter((p) => p?.name && !p.private).map((p) => p.name as string))];
  if (!names.length) return;
  const header = names.map((n) => `"${n}": major`).join("\n");
  fs.writeFileSync(path.join(dir, ".changeset", "upgrade-ai-sdk-7.md"), `---\n${header}\n---\n\nUpgrade to AI SDK 7. Requires ai@7 and Node.js 22 or later.\n`);
}
