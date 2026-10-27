import fs from "node:fs";
import path from "node:path";
import { run, type ExecResult } from "./exec.js";

export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";
/** "install", "build", or "typecheck <pkg>" / "test <pkg>" for each package that uses ai. */
export type GateName = string;
export type GateResults = Record<GateName, ExecResult>;

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
export function runGates(dir: string, pm: PackageManager, frozen: boolean, pkgDirs: string[]): GateResults {
  const results: GateResults = { install: install(dir, pm, frozen) };
  if (!results.install!.ok) return results;
  if (typeof readPkg(dir)?.scripts?.build === "string") results.build = run(pm, ["run", "build"], dir);

  for (const pkgDir of gateOrder(dir, pkgDirs).slice(0, MAX_GATED_PACKAGES)) {
    const rel = path.relative(dir, pkgDir) || ".";
    if (fs.existsSync(path.join(pkgDir, "tsconfig.json"))) {
      results[`typecheck ${rel}`] = run("npx", ["--no-install", "tsc", "--noEmit", "-p", "tsconfig.json"], pkgDir);
    }
    const testScript = readPkg(pkgDir)?.scripts?.test;
    if (typeof testScript === "string" && !testScript.includes("no test specified")) {
      results[`test ${rel}`] = run(pm, ["run", "test"], pkgDir);
    }
  }
  return results;
}

const MAX_GATED_PACKAGES = 12;

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

/** A gate counts only if it passed before we touched anything: we can't be blamed for, or fix, a red baseline. */
export function regressions(baseline: GateResults, after: GateResults): GateName[] {
  return Object.keys(baseline).filter((g) => baseline[g]?.ok && !after[g]?.ok);
}

export function readPkg(dir: string): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return undefined;
  }
}
