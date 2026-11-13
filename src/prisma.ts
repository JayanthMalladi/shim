import fs from "node:fs";
import path from "node:path";
import { targetEnv, run, type ExecResult } from "./exec.js";
import { findPackages, readJson } from "./scan.js";

/**
 * The GateResults key Shim records `prisma generate` under. It is informational only — never a
 * gate for regressions() or the PR checks table — because generate runs identically at baseline
 * and after. Every consumer of gate keys filters it out by this name.
 */
export const PRISMA_GENERATE_GATE = "prisma generate";

/** The two generator providers that build Prisma's own client and run no repo code. Everything else
 *  ("node ./gen.js", "zod-prisma-types", "npx ...", ...) is arbitrary repo code and must not run. */
const SAFE_PROVIDERS = new Set(["prisma-client-js", "prisma-client"]);

export interface PrismaGenCmd {
  args: string[];
  cwd: string;
}

/**
 * Which schema a package dir points at, the way Prisma resolves it: a custom `prisma.schema` path in
 * package.json, else `prisma/schema.prisma`, else `schema.prisma`, else a multi-file `prisma/schema/`
 * folder (the folder itself is passed to generate). None of these exist in node_modules.
 */
function findSchema(pkgDir: string): string | undefined {
  const custom = readJson(path.join(pkgDir, "package.json"))?.prisma?.schema;
  if (typeof custom === "string") {
    const p = path.join(pkgDir, custom);
    if (fs.existsSync(p)) return p;
  }
  for (const c of [path.join(pkgDir, "prisma", "schema.prisma"), path.join(pkgDir, "schema.prisma")]) {
    if (fs.existsSync(c)) return c;
  }
  const dir = path.join(pkgDir, "prisma", "schema");
  if (fs.existsSync(dir)) return dir;
  return undefined;
}

/** The provider strings of every `generator` block in `schema` (a file, or a multi-file folder). */
function generatorProviders(schema: string): string[] {
  const files = fs.statSync(schema).isDirectory()
    ? fs.readdirSync(schema).filter((f) => f.endsWith(".prisma")).map((f) => path.join(schema, f))
    : [schema];
  const providers: string[] = [];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/generator\s+\w+\s*\{([^}]*)\}/g)) {
      const p = m[1]!.match(/provider\s*=\s*["']([^"']+)["']/);
      providers.push(p ? p[1]! : "");
    }
  }
  return providers;
}

/** Package dirs (relative to dir) that depend on the prisma CLI or the generated client. */
function prismaPackageDirs(dir: string): string[] {
  const dirs = new Set<string>();
  for (const dep of ["prisma", "@prisma/client"]) for (const p of findPackages(dir, dep)) dirs.add(path.dirname(p.file));
  return [...dirs];
}

/**
 * E9: the safe `prisma generate` commands for every prisma package in dir, and a human-readable
 * reason for each package that must be skipped. A package is skipped when a `prisma.config.*` is
 * present (Prisma 6.6+ loads it as code) or any generator provider is not prisma-client(-js) (it
 * would run the repo's own code). generate never seeds and Shim adds no seeding flag, so a
 * `prisma.seed` entry is not a skip on its own. No spawning happens here — it is pure, so it is
 * testable against temp dirs without touching prisma.
 */
export function prismaGenerateCmds(dir: string): { cmds: PrismaGenCmd[]; skipped: string[] } {
  const cmds: PrismaGenCmd[] = [];
  const skipped: string[] = [];
  for (const pkgDir of prismaPackageDirs(dir)) {
    const rel = path.relative(dir, pkgDir) || ".";
    if (["prisma.config.ts", "prisma.config.js", "prisma.config.mjs"].some((f) => fs.existsSync(path.join(pkgDir, f)))) {
      skipped.push(`${rel}: skipped — a prisma.config.* file loads as code, so generate was not run`);
      continue;
    }
    const schema = findSchema(pkgDir);
    if (!schema) continue;
    const providers = generatorProviders(schema);
    const unsafe = providers.filter((p) => !SAFE_PROVIDERS.has(p));
    if (unsafe.length) {
      skipped.push(`${rel}: skipped — generator provider ${unsafe.map((p) => `"${p || "missing"}"`).join(", ")} runs repo code, not prisma-client`);
      continue;
    }
    cmds.push({ args: ["--no-install", "prisma", "generate", "--schema", schema], cwd: pkgDir });
  }
  return { cmds, skipped };
}

/** The runner shape gates.ts hands to runPrismaGenerate; injectable so tests never spawn prisma. */
export type PrismaGenRunner = (cmd: PrismaGenCmd) => ExecResult;

const defaultRunner: PrismaGenRunner = (c) =>
  run("npx", c.args, c.cwd, 10 * 60_000, { ...targetEnv(), PRISMA_HIDE_UPDATE_MESSAGE: "1", CHECKPOINT_DISABLE: "1" });

/**
 * Run the safe prisma generate commands in dir, one per prisma package. Returns undefined when the
 * repo has no prisma package at all (no key is stored). When every prisma package was skipped for
 * safety, the key still records the reasons (ok=true: nothing ran, and generate is informational,
 * not a gate). When commands run, their aggregated result is recorded but never gates anything: a
 * failure (e.g. offline, so Prisma's own engine download fails) is captured here and left to
 * install/build to surface.
 */
export function runPrismaGenerate(dir: string, runner: PrismaGenRunner = defaultRunner): ExecResult | undefined {
  const { cmds, skipped } = prismaGenerateCmds(dir);
  const reasons = skipped.map((s) => `[skipped] ${s}`);
  if (cmds.length === 0) return reasons.length ? { ok: true, code: 0, output: reasons.join("\n"), ms: 0 } : undefined;
  const results = cmds.map(runner);
  const ok = results.every((r) => r.ok);
  const output = [...reasons, ...results.map((r) => r.output)].join("\n");
  return { ok, code: ok ? 0 : 1, output: output.slice(-8000), ms: results.reduce((s, r) => s + r.ms, 0) };
}
