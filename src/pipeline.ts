import fs from "node:fs";
import path from "node:path";
import { runReviewer, type Review } from "./agent.js";
import { bumpAiSdk } from "./bump.js";
import { adopt, fixInParallel, rank } from "./candidates.js";
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
  /** Raw output of each fixer-agent attempt on the chosen candidate. */
  agentRuns: string[];
  /** Every parallel fixer candidate, for tuning the fixer across the fleet. */
  candidates: { ok: boolean; size: number; regressions: GateName[]; remaining: number }[];
  /** The independent reviewer's verdict on the final diff, when the agent ran. */
  review?: Omit<Review, "output">;
  diffStat: string;
  /** Files this PR changes; a finding counts as fixed only if its file is among them. */
  changedFiles: string[];
  /** Checks the upgrade broke that the fixer then repaired. */
  repairedChecks: GateName[];
}

const CANDIDATES = 3;
const ATTEMPTS_PER_CANDIDATE = 2;

const gateSummary = (g: GateResults) =>
  Object.fromEntries(Object.entries(g).map(([k, v]) => [k, !!v?.ok]));

export async function migrate(dir: string, repo: string, opts: MigrateOptions): Promise<MigrationReport> {
  const log = (msg: string) => console.error(`[shim] ${msg}`);
  const base = { repo, versionChanges: [], library: false, codemod: false, autoFixed: 0, before: [], remaining: [], baseline: {}, after: {}, regressions: [], failures: {}, agentRuns: [], candidates: [], diffStat: "", changedFiles: [], repairedChecks: [] };

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
  const brokenByUpgrade = regressions(baseline, after);
  let remaining = dedupe([...forAgent, ...postBreaks()]);
  const agentRuns: string[] = [];
  let candidates: MigrationReport["candidates"] = [];
  let review: MigrationReport["review"];

  if (opts.agent && (remaining.length || regressions(baseline, after).length)) {
    log(`${CANDIDATES} fixer candidates: ${remaining.length} findings, ${regressions(baseline, after).length} failing checks`);
    const cands = await fixInParallel(dir, CANDIDATES, ATTEMPTS_PER_CANDIDATE, {
      baseline, after, findings: remaining,
      failingOutput: (a) => Object.entries(a)
        .filter(([g, r]) => g !== "install" && !r.ok && baseline[g]?.ok)
        .map(([g, r]) => `${g}:\n${r.output.slice(-3000)}`)
        .join("\n\n"),
      // Same packages, inside the candidate's copy: absolute paths would gate the original repo.
      gates: (d) => runGates(d, pm, false, pkgDirs.map((p) => path.join(d, path.relative(dir, p)))),
      breaks: (d) => scan(d).result.findings.filter((f) => f.severity === "break" && f.fix !== "manual"),
    });
    const ranked = rank(cands, baseline);
    candidates = cands.map((c) => ({ ok: c.ok, size: c.size, regressions: regressions(baseline, c.after), remaining: c.remaining.length }));
    // Review passing candidates smallest first; the first one the reviewer approves wins.
    let chosen = ranked[0]!;
    for (const c of ranked.filter((c) => c.ok)) {
      log(`reviewing candidate (${c.size} lines)`);
      review = await runReviewer(c.dir);
      if (review.approve) { chosen = c; break; }
    }
    adopt(dir, chosen, cands);
    after = chosen.after;
    remaining = chosen.remaining;
    agentRuns.push(...chosen.agentRuns);
  } else if (opts.agent && !regressions(baseline, after).length) {
    log("reviewing diff");
    review = await runReviewer(dir);
  }
  const before = pre.findings;
  formatChanged(dir);
  addChangeset(dir, pkgDirs);

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
    before, remaining, baseline: gateSummary(baseline), after: gateSummary(after), regressions: regressed, diffStat, changedFiles, repairedChecks, agentRuns, candidates,
    review: review && { approve: review.approve, issues: review.issues },
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
