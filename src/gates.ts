import fs from "node:fs";
import path from "node:path";
import { run, type ExecResult } from "./exec.js";

export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";
export type GateName = "install" | "typecheck" | "test";
export type GateResults = Partial<Record<GateName, ExecResult>>;

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

export function runGates(dir: string, pm: PackageManager, frozen: boolean): GateResults {
  const results: GateResults = { install: install(dir, pm, frozen) };
  if (!results.install!.ok) return results;

  if (fs.existsSync(path.join(dir, "tsconfig.json"))) {
    results.typecheck = run("npx", ["--no-install", "tsc", "--noEmit", "-p", "tsconfig.json"], dir);
  }
  const testScript = readPkg(dir)?.scripts?.test;
  if (typeof testScript === "string" && !testScript.includes("no test specified")) {
    results.test = run(pm, ["run", "test"], dir);
  }
  return results;
}

/** A gate counts only if it passed before we touched anything: we can't be blamed for, or fix, a red baseline. */
export function regressions(baseline: GateResults, after: GateResults): GateName[] {
  return (Object.keys(baseline) as GateName[]).filter((g) => baseline[g]?.ok && !after[g]?.ok);
}

export function readPkg(dir: string): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return undefined;
  }
}
