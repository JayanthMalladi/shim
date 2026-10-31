import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, type ExecResult } from "./exec.js";

export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";
/** "install", "build", or "typecheck <pkg>" / "test <pkg>" for each package that uses ai. */
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
 * Install without lifecycle scripts: we run untrusted repos, and postinstall
 * hooks are the classic way to execute code on install.
 */
export function install(dir: string, pm: PackageManager, frozen: boolean): ExecResult {
  switch (pm) {
    case "pnpm":
      return run("pnpm", ["install", "--ignore-scripts", frozen ? "--frozen-lockfile" : "--no-frozen-lockfile"], dir);
    case "yarn":
      return run("yarn", ["install", "--ignore-scripts", ...(frozen ? ["--frozen-lockfile"] : [])], dir);
    case "bun":
      return run("bun", ["install", "--ignore-scripts", ...(frozen ? ["--frozen-lockfile"] : [])], dir);
    default:
      return run("npm", [frozen && fs.existsSync(path.join(dir, "package-lock.json")) ? "ci" : "install", "--ignore-scripts", "--no-audit", "--no-fund"], dir);
  }
}

/**
 * Install once at the root, build if the root has a build script (monorepo packages
 * often import each other's built output), then type check and test every package
 * that depends on ai, plus the root.
 */
export function runGates(dir: string, pm: PackageManager, frozen: boolean, pkgDirs: string[], opts: { install?: boolean } = {}): GateResults {
  const results: GateResults = {
    install: opts.install === false ? { ok: true, code: 0, output: "skipped: dependencies unchanged", ms: 0 } : install(dir, pm, frozen),
  };
  if (!results.install!.ok) return results;
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
