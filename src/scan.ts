import fs from "node:fs";
import path from "node:path";
import { Project } from "ts-morph";
import { applyAutoFixes, scanAiSdkV7, type RuleContext } from "./rules/ai-sdk-v7.js";
import type { Finding, ScanResult } from "./types.js";

const IGNORED_DIRS = ["node_modules", "dist", "build", ".next", ".turbo", "out", "coverage", ".git"];
const SOURCE_GLOB = "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}";

export function loadProject(root: string): Project {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true, jsx: 4 /* preserve-ish: we never emit */ },
  });
  project.addSourceFilesAtPaths([
    path.join(root, SOURCE_GLOB),
    ...IGNORED_DIRS.map((d) => "!" + path.join(root, "**", d, "**")),
    "!" + path.join(root, "**", "*.d.ts"),
  ]);
  return project;
}

export function scan(root: string): { result: ScanResult; project: Project; ctx: RuleContext } {
  const abs = path.resolve(root);
  const project = loadProject(abs);
  const ctx = scanAiSdkV7(project, abs);
  ctx.findings.push(...checkPackageJsons(abs));
  ctx.findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { result: { root: abs, filesScanned: project.getSourceFiles().length, findings: ctx.findings }, project, ctx };
}

export async function scanAndFix(root: string) {
  const { result, project, ctx } = scan(root);
  const applied = await applyAutoFixes(project, ctx);
  return { result, applied };
}

/** Every package.json in the repo, workspace packages and the root included. */
export function findPackageJsons(root: string): string[] {
  const out: string[] = [];
  walk(root, (file) => {
    if (path.basename(file) === "package.json") out.push(file);
  });
  return out;
}

/** package.json files (including workspaces) that depend on ai@6. */
export function findAiPackages(root: string): Array<{ file: string; range: string }> {
  const out: Array<{ file: string; range: string }> = [];
  walk(root, (file) => {
    if (path.basename(file) !== "package.json") return;
    const pkg = readJson(file);
    const range = pkg?.dependencies?.ai ?? pkg?.devDependencies?.ai ?? pkg?.peerDependencies?.ai;
    if (typeof range === "string") out.push({ file, range });
  });
  return out;
}

function checkPackageJsons(root: string): Finding[] {
  const findings: Finding[] = [];
  for (const { file } of findAiPackages(root)) {
    const engine = readJson(file)?.engines?.node;
    if (typeof engine === "string" && !/(>=?\s*(2[2-9]|[3-9]\d))|(^\s*\^?(2[2-9]|[3-9]\d))/.test(engine)) {
      findings.push({
        ruleId: "node-22",
        severity: "break",
        fix: "manual",
        file: path.relative(root, file),
        line: 1,
        snippet: `"engines": { "node": "${engine}" }`,
        message: "AI SDK 7 requires Node.js 22 or later.",
      });
    }
  }
  return findings;
}

function walk(dir: string, visit: (file: string) => void) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else visit(full);
  }
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}
