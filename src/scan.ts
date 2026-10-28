import fs from "node:fs";
import path from "node:path";
import { Project } from "ts-morph";
import { applyAutoFixes, scanAiSdkV7, type RuleContext } from "./rules/ai-sdk-v7.js";
import { runCapture } from "./exec.js";
import type { Finding, ScanResult } from "./types.js";

const IGNORED_DIRS = ["node_modules", "dist", "build", ".next", ".turbo", "out", "coverage", ".git"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

export function loadProject(root: string): Project {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true, jsx: 4 /* preserve-ish: we never emit */ },
  });
  for (const file of sourceFiles(root)) project.addSourceFileAtPath(file);
  return project;
}

/**
 * The source files the scanner sees. In a git work tree whose root is the scan dir, that is what
 * git would commit: tracked files plus untracked files that are not ignored, so gitignored build
 * outputs are never scanned or flagged. Anything else — a subfolder of a repo, an ignored folder of
 * an outer repo, or no repo at all — falls back to a filesystem walk. Either way the built dirs
 * and declaration files are skipped by name, as a safety net.
 */
export function sourceFiles(root: string): string[] {
  const abs = path.resolve(root);
  const git = gitListedFiles(abs);
  const found = git ? git.map((f) => path.join(abs, f)) : walkSource(abs);
  return found.filter((f) => {
    if (f.endsWith(".d.ts")) return false;
    const rel = path.relative(abs, f);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return false; // keep files inside the root
    let st;
    try {
      st = fs.statSync(f);
    } catch {
      return false; // staged for deletion or otherwise gone
    }
    if (!st.isFile()) return false; // git lists untracked dirs too
    if (!SOURCE_EXTENSIONS.has(path.extname(f))) return false;
    // A name filter over the git list: repos that do not ignore node_modules would pull it in.
    return !IGNORED_DIRS.some((d) => rel.split(path.sep).includes(d));
  });
}

/**
 * `git ls-files` for a root, or undefined when git's list is not authoritative. The list is only
 * trusted when the root IS a repo root: inside an outer repo — including one of its gitignored
 * folders — `git ls-files` succeeds against the outer repo and returns nothing (or wrong files).
 * Compare realpath'd paths because Windows paths can differ in case and symlink form.
 */
function gitListedFiles(abs: string): string[] | undefined {
  const top = runCapture("git", ["rev-parse", "--show-toplevel"], abs);
  if (!top.ok) return undefined;
  try {
    if (fs.realpathSync(top.stdout.trim()) !== fs.realpathSync(abs)) return undefined;
  } catch {
    return undefined;
  }
  const git = runCapture("git", ["ls-files", "-z", "-co", "--exclude-standard"], abs);
  if (!git.ok) return undefined;
  // -z NUL-separates: non-ASCII paths come back without shell-style quoting.
  return git.stdout.split("\0").filter(Boolean);
}

/** The fallback for a folder that is not a git repo: walk, skipping the built/ignored dirs. */
function walkSource(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSource(full, out);
    else out.push(full);
  }
  return out;
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
