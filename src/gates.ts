import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, targetEnv, type ExecResult } from "./exec.js";
import { PRISMA_GENERATE_GATE, runPrismaGenerate, type PrismaGenRunner } from "./prisma.js";

export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";
/** "install", "prisma generate" (informational, not a gate), "build", or "typecheck <pkg>" / "test <pkg>" for each package that uses ai. */
export type GateName = string;
export type GateResults = Record<GateName, ExecResult>;

/** Per-test outcome for a test gate: id (relative file + full test name) -> passed. */
export type PerTest = Record<string, boolean>;

export function detectPackageManager(dir: string): PackageManager {
  if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(dir, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(dir, "bun.lockb")) || fs.existsSync(path.join(dir, "bun.lock"))) return "bun";
  return "npm";
}

/**
 * True when the repo's yarn is Berry (v2+): it has a `.yarnrc.yml`, or (no `.yarnrc.yml`) the
 * installed `yarn --version` reports a major of 2 or higher. Berry is what elifesciences uses; its
 * `yarn install --ignore-scripts` exits 1, so it needs a different install command (see
 * yarnInstallArgs).
 */
export function isYarnBerry(dir: string): boolean {
  if (fs.existsSync(path.join(dir, ".yarnrc.yml"))) return true;
  const r = run("yarn", ["--version"], dir, 30_000);
  if (!r.ok) return false; // no yarn on PATH: assume classic (the caller's install will surface a real error)
  const major = Number(r.output.trim().split("\n").pop()?.match(/^\d+/)?.[1] ?? "0");
  return major >= 2;
}

/**
 * The `yarn install` command Shim chooses for a repo. Berry (v2+) has no `--ignore-scripts` flag
 * (it errors): scripts are disabled via the YARN_ENABLE_SCRIPTS env, and the frozen lockfile is
 * enforced with `--immutable`. Classic (v1) keeps `--ignore-scripts` and `--frozen-lockfile`.
 * Lifecycle scripts never run in either branch. Pure (no git, no yarn): the caller passes its own
 * berry decision so this is testable without running yarn.
 */
export function yarnInstallArgs(berry: boolean, frozen: boolean): { args: string[]; env: NodeJS.ProcessEnv } {
  if (berry) {
    return { args: ["install", ...(frozen ? ["--immutable"] : [])], env: { ...targetEnv(), YARN_ENABLE_SCRIPTS: "false" } };
  }
  return { args: ["install", "--ignore-scripts", ...(frozen ? ["--frozen-lockfile"] : [])], env: targetEnv() };
}

/**
 * The no-lifecycle-script install command for every package manager, as a pure choice (no spawn),
 * so it is unit-testable without a real install. The yarn case delegates to yarnInstallArgs so
 * Berry detection (isYarnBerry: .yarnrc.yml or a `yarn --version` major >= 2) stays in one place.
 * For a `yarn` repo the returned env is the one install() must run with; other managers have none.
 */
export function installCmd(dir: string, pm: PackageManager, frozen: boolean): { cmd: string; args: string[]; env: NodeJS.ProcessEnv } {
  switch (pm) {
    case "pnpm":
      return { cmd: "pnpm", args: ["install", "--ignore-scripts", frozen ? "--frozen-lockfile" : "--no-frozen-lockfile"], env: targetEnv() };
    case "yarn": {
      const c = yarnInstallArgs(isYarnBerry(dir), frozen);
      return { cmd: "yarn", args: c.args, env: c.env };
    }
    case "bun":
      return { cmd: "bun", args: ["install", "--ignore-scripts", ...(frozen ? ["--frozen-lockfile"] : [])], env: targetEnv() };
    default:
      return { cmd: "npm", args: [frozen && fs.existsSync(path.join(dir, "package-lock.json")) ? "ci" : "install", "--ignore-scripts", "--no-audit", "--no-fund"], env: targetEnv() };
  }
}

/**
 * Install without lifecycle scripts: we run untrusted repos, and postinstall
 * hooks are the classic way to execute code on install.
 */
export function install(dir: string, pm: PackageManager, frozen: boolean): ExecResult {
  const c = installCmd(dir, pm, frozen);
  return run(c.cmd, c.args, dir, 10 * 60_000, c.env);
}

/**
 * Install once at the root, build if the root has a build script (monorepo packages
 * often import each other's built output), then type check and test every package
 * that depends on ai, plus the root.
 */
export function runGates(dir: string, pm: PackageManager, frozen: boolean, pkgDirs: string[], opts: { install?: boolean; prismaRunner?: PrismaGenRunner } = {}): GateResults {
  const before = new Set(untracked(dir));
  try {
    return gates(dir, pm, frozen, pkgDirs, opts);
  } finally {
    // Build and test outputs a repo doesn't gitignore are not part of the change: drop them so they
    // reach neither the reviewer nor changes.patch. Untracked files that were there before (the
    // fixer's new files) stay.
    for (const f of untracked(dir)) if (!before.has(f)) fs.rmSync(path.join(dir, f), { force: true });
  }
}

/** Untracked files git doesn't ignore, relative to dir; none outside a git repo. node_modules is never listed. */
function untracked(dir: string): string[] {
  try {
    return execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z", "--", ".", ":(exclude,glob)**/node_modules/**"], { cwd: dir, encoding: "utf8", env: targetEnv(), maxBuffer: 256 * 1024 * 1024 })
      .split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

function gates(dir: string, pm: PackageManager, frozen: boolean, pkgDirs: string[], opts: { install?: boolean; prismaRunner?: PrismaGenRunner }): GateResults {
  const results: GateResults = {
    install: opts.install === false ? { ok: true, code: 0, output: "skipped: dependencies unchanged", ms: 0 } : install(dir, pm, frozen),
  };
  if (!results.install!.ok) return results;
  // @prisma/client's postinstall is skipped (--ignore-scripts), so its generated client is missing
  // until we run prisma generate ourselves. Informational only: excluded from regressions() and the
  // PR checks table (see PRISMA_GENERATE_GATE), and it runs identically at baseline and after.
  const prisma = runPrismaGenerate(dir, opts.prismaRunner);
  if (prisma) results[PRISMA_GENERATE_GATE] = prisma;
  if (typeof readPkg(dir)?.scripts?.build === "string") results.build = run(pm, ["run", "build"], dir);

  for (const pkgDir of gateOrder(dir, pkgDirs).slice(0, MAX_GATED_PACKAGES)) {
    const rel = path.relative(dir, pkgDir) || ".";
    // The package's own script wins: it may check more than tsconfig.json does (a test tsconfig, project references).
    if (hasTypecheckScript(pkgDir)) {
      results[`typecheck ${rel}`] = run(pm, ["run", "typecheck"], pkgDir);
    } else if (fs.existsSync(path.join(pkgDir, "tsconfig.json"))) {
      results[`typecheck ${rel}`] = run("npx", ["--no-install", "tsc", "--noEmit", "-p", "tsconfig.json"], pkgDir);
    }
    const testScript = readPkg(pkgDir)?.scripts?.test;
    if (typeof testScript === "string" && !testScript.includes("no test specified")) {
      results[`test ${rel}`] = capturePerTest(run(pm, ["run", "test"], pkgDir), pkgDir, readPkg(pkgDir));
    }
  }
  return results;
}

const MAX_GATED_PACKAGES = 12;

export function hasTypecheckScript(pkgDir: string): boolean {
  return typeof readPkg(pkgDir)?.scripts?.typecheck === "string";
}

type TestRunner = "vitest" | "jest";

/**
 * Which test runner the package's `test` script uses, when it is one of the two we can capture
 * per-test JSON from: the script text is checked first, then `devDependencies`.
 */
export function detectTestRunner(script: string | undefined, pkg: any): TestRunner | undefined {
  if (typeof script === "string") {
    if (/vitest/.test(script) && !/jest/.test(script)) return "vitest";
    if (/jest/.test(script) && !/vitest/.test(script)) return "jest";
  }
  const devDeps = (pkg?.devDependencies ?? {}) as Record<string, unknown>;
  if ("vitest" in devDeps) return "vitest";
  if ("jest" in devDeps) return "jest";
  return undefined;
}

/**
 * Re-run the `test` gate with a JSON reporter and store the per-test outcome on `entry`. CI=1 in the
 * target environment keeps vitest out of watch mode. If the runner can't be detected, or the JSON can't
 * be written/parsed, `entry` is returned unchanged and the gate-level comparison still applies.
 */
export function capturePerTest(entry: ExecResult, pkgDir: string, pkg: any): ExecResult {
  const script = typeof pkg?.scripts?.test === "string" ? pkg.scripts.test : undefined;
  const runner = detectTestRunner(script, pkg);
  if (!runner) return entry;
  const jsonFile = path.join(os.tmpdir(), `shim-${runner}-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  const args = runner === "vitest"
    ? ["--no-install", "vitest", "run", "--reporter=json", `--outputFile=${jsonFile}`]
    : ["--no-install", "jest", "--json", `--outputFile=${jsonFile}`];
  run("npx", args, pkgDir);
  const perTest = runner === "vitest" ? parseVitestJson(jsonFile, pkgDir) : parseJestJson(jsonFile, pkgDir);
  try { fs.unlinkSync(jsonFile); } catch {}
  if (perTest) entry.perTest = perTest;
  return entry;
}

/** vitest JSON: `testResults[].name` holds the file, `assertionResults[].fullName` the full test name. */
export function parseVitestJson(file: string, cwd: string): PerTest | undefined {
  let j: any;
  try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; }
  const out: PerTest = {};
  for (const suite of Array.isArray(j?.testResults) ? j.testResults : []) {
    const rel = slash(path.relative(cwd, suite.name ?? ""));
    for (const a of Array.isArray(suite.assertionResults) ? suite.assertionResults : []) {
      const name = typeof a?.fullName === "string" && a.fullName ? a.fullName : a?.title;
      if (typeof name !== "string" || !name) continue;
      out[`${rel}/${name}`] = a.status === "passed";
    }
  }
  return out;
}

/** jest JSON: `testResults[].testFilePath` holds the file, `testResults[].assertionResults[]` the tests. */
export function parseJestJson(file: string, cwd: string): PerTest | undefined {
  let j: any;
  try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; }
  const out: PerTest = {};
  for (const suite of Array.isArray(j?.testResults) ? j.testResults : []) {
    const rel = slash(path.relative(cwd, suite.testFilePath ?? suite.name ?? ""));
    for (const a of Array.isArray(suite.assertionResults) ? suite.assertionResults : []) {
      const name = typeof a?.fullName === "string" && a.fullName ? a.fullName : a?.title;
      if (typeof name !== "string" || !name) continue;
      out[`${rel}/${name}`] = a.status === "passed";
    }
  }
  return out;
}

/** Forward-slash form of a relative path: a stable test id across Windows and POSIX. */
function slash(rel: string): string {
  return rel.split(path.sep).join("/");
}

/**
 * Which packages to check, most important first: the root, then published packages, then private
 * apps and demos. Cloudflare's repo has 20 demos ahead of its 4 published providers alphabetically,
 * so a plain cap checked only demos.
 */
export function gateOrder(dir: string, pkgDirs: string[]): string[] {
  const published = (d: string) => {
    const pkg = readPkg(d);
    return !!pkg?.name && !pkg.private;
  };
  const rest = [...new Set(pkgDirs)].filter((d) => d !== dir);
  return [dir, ...rest.filter(published), ...rest.filter((d) => !published(d))];
}

/** True if at least one type check or test passed at baseline, so the change can be validated at all. */
export function hasValidation(baseline: GateResults): boolean {
  return Object.entries(baseline).some(([name, r]) => /^(typecheck|test) /.test(name) && r.ok);
}

/**
 * A gate counts only if it passed before we touched anything: we can't be blamed for, or fix, a red
 * baseline. For vitest/jest gates we compare per-test instead of pass/fail-per-gate: a test that
 * passed at baseline now failing or going missing is a regression even when the gate was already
 * red at baseline (the old gate-level comparison would have hidden that breakage).
 */
export function regressions(baseline: GateResults, after: GateResults): GateName[] {
  return Object.keys(baseline).filter((g) => {
    if (g === PRISMA_GENERATE_GATE) return false; // informational: not a gate, excluded like install-skipped
    const gateRegressed = baseline[g]?.ok && !after[g]?.ok;
    const b = baseline[g]?.perTest;
    const a = after[g]?.perTest;
    const lostTest = !!(b && a) && Object.keys(b).some((id) => b[id] && a[id] !== true);
    return gateRegressed || lostTest;
  });
}

export function readPkg(dir: string): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return undefined;
  }
}
