import fs from "node:fs";
import path from "node:path";
import { Project } from "ts-morph";
import { applyAutoFixes, scanAiSdkV7, type RuleContext } from "./rules/ai-sdk-v7.js";
import { runCapture } from "./exec.js";
import type { Finding, FixKind, ScanResult } from "./types.js";

/** AI SDK 7's minimum Node version; CI that runs below it goes red on day one. */
const NODE_REQUIRED = 22;

/** One stable message per outcome so pr-body's group() buckets every location into a single line. */
const CI_NODE_AUTO_MSG =
  "CI runs on a Node version below 22; AI SDK 7 requires Node 22 — the Node version was updated to 22.";
const CI_NODE_FILE_MSG =
  "CI pins its Node version in a file that is below 22; AI SDK 7 requires Node 22 — update the file.";

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
  ctx.findings.push(...checkCiNodeVersions(abs, ctx));
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

/**
 * CI workflows that run on a Node version below 22 go red the moment the PR triggers them.
 * Plain-text scan of .github/workflows: rewrite the scalar/inline-list `node-version` values to 22
 * (keeping quoting/indent), resolve a `matrix.<name>` expression to its inline list in the same job,
 * and flag `node-version-file:` values below 22 as manual (the file itself is never edited).
 */
function checkCiNodeVersions(root: string, ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const wf of findWorkflowFiles(root)) {
    const rel = path.relative(root, wf).split(path.sep).join("/");
    const raw = fs.readFileSync(wf, "utf8");
    // Windows checkouts can be CRLF (core.autocrlf): strip \r so the line regexes hold;
    // re-emission of the line ending happens in applyAutoFixes (the pure reader invariant stays here).
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    if (!namesPrOrPush(lines)) continue; // only PR/push-triggered workflows matter here
    const edits: Array<{ line: number; text?: string; delete?: boolean }> = [];
    const flag = (line: number, snippet: string, fix: FixKind, message: string) =>
      findings.push({ ruleId: "ci-node-version", severity: "break", fix, file: rel, line, snippet, message });

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const nfv = line.match(/^(\s*)node-version-file:\s*(\S.*)?$/);
      if (nfv) {
        const fname = nfv[2]?.trim();
        if (fname && !fname.startsWith("#")) {
          const major = readNodeFileMajor(root, fname);
          if (major !== null && major < NODE_REQUIRED) flag(i + 1, line.trim().slice(0, 160), "manual", CI_NODE_FILE_MSG);
        }
        continue;
      }
      const nv = line.match(/^(\s*)node-version:\s*(.*)$/);
      if (!nv) continue;
      const indent = nv[1] ?? "";
      const value = (nv[2] ?? "").trim();
      const at = i + 1;

      if (value.startsWith("${{")) continue;
      // The matrix list it references is itself a `node-version:` line earlier in the job and is
      // rewritten in its own pass, so the expression stays untouched here.
      if (value === "") {
        handleBlockList(lines, edits, flag, i, indent.length, at, line);
        continue;
      }
      if (value.startsWith("[")) {
        const entries = splitList(value.slice(1, value.lastIndexOf("]")));
        if (!entries.some((e) => below(e))) continue;
        const kept = entries.filter((e) => !below(e));
        edits.push({ line: at, text: `${indent}node-version: [${(kept.length ? kept : ["22"]).join(", ")}]` });
        flag(at, line.trim().slice(0, 160), "auto", CI_NODE_AUTO_MSG);
        continue;
      }
      const mj = parseMajor(value);
      if (mj !== null && mj < NODE_REQUIRED) {
        const w = rewriteScalar(value);
        edits.push({ line: at, text: `${indent}node-version: ${w}` });
        flag(at, line.trim().slice(0, 160), "auto", CI_NODE_AUTO_MSG);
      }
    }

    if (edits.length) ctx.fileEdits.push({ file: rel, lines: edits });
  }
  return findings;
}

/** The indented `- x` list under a bare `node-version:` key. */
function handleBlockList(
  lines: string[],
  edits: Array<{ line: number; text?: string; delete?: boolean }>,
  flag: (line: number, snippet: string, fix: FixKind, message: string) => void,
  i: number,
  base: number,
  at: number,
  line: string,
): void {
  const entries: Array<{ idx: number; ind: number; val: string }> = [];
  for (let j = i + 1; j < lines.length; j++) {
    const em = lines[j]!.match(/^(\s*)-\s*(\S.*)$/);
    if (!em || (em[1]?.length ?? 0) <= base) break;
    entries.push({ idx: j, ind: em[1]!.length, val: em[2]!.trim() });
  }
  if (!entries.some((e) => below(e.val))) return;
  const kept = entries.filter((e) => !below(e.val));
  // A rewritten `- 22` line replaces the first entry; deleted lines are dropped whole.
  if (kept.length === 0) {
    const first = entries[0]!;
    edits.push({ line: first.idx + 1, text: `${" ".repeat(first.ind)}- 22` });
    for (let k = 1; k < entries.length; k++) edits.push({ line: entries[k]!.idx + 1, delete: true });
  } else for (const e of entries) if (!kept.includes(e)) edits.push({ line: e.idx + 1, delete: true });
  flag(at, line.trim().slice(0, 160), "auto", CI_NODE_AUTO_MSG);
}

/** True for a `node-version` value below 22; null-ish (lts, latest, node, expressions) is never below. */
function below(raw: string): boolean {
  const mj = parseMajor(raw);
  return mj !== null && mj < NODE_REQUIRED;
}

/** A below-22 `node-version` value. null (lts, latest, node, an expression) is never treated as below. */
function parseMajor(raw: string): number | null {
  let s = raw.trim();
  if (!s || s.startsWith("${{")) return null;
  const q = s[0];
  if ((q === "'" || q === '"') && s.length >= 2 && s.endsWith(q)) s = s.slice(1, -1).trim();
  if (/^(lts|latest|node)\b/.test(s)) return null;
  const m = s.match(/^\d+/);
  return m ? Number(m[0]) : null;
}

/** `20` -> `22`, `20.x` -> `22.x`, `'20'` -> `'22'`, `"20.x"` -> `"22.x"`: keep the original quoting. */
function rewriteScalar(value: string): string {
  const s = value.trim();
  const q = s[0];
  const quoted = q === "'" || q === '"';
  const inner = quoted ? s.slice(1, -1) : s;
  const base = /\.(x|\*)/.test(inner) ? "22.x" : "22";
  return quoted ? `${q}${base}${q}` : base;
}

function splitList(inner: string): string[] {
  return inner.split(",").map((e) => e.trim()).filter((e) => e.length > 0);
}

/** The `node-version-file` target (`.nvmrc`, `.node-version`): its major version, or null if unreadable. */
function readNodeFileMajor(root: string, filename: string): number | null {
  try {
    return parseMajor(fs.readFileSync(path.join(root, filename), "utf8").trim().split(/\s/)[0] ?? "");
  } catch {
    return null;
  }
}

/** .github/workflows/*.yml|yaml, walked from the repo root. */
function findWorkflowFiles(root: string): string[] {
  const out: string[] = [];
  walk(root, (file) => {
    const parts = path.relative(root, file).split(path.sep);
    if (
      parts.length >= 3 &&
      parts[parts.length - 1]!.match(/\.(yml|yaml)$/i) &&
      parts[parts.length - 2] === "workflows" &&
      parts[parts.length - 3] === ".github"
    )
      out.push(file);
  });
  return out;
}

/** True when the top-level `on:` block (or its inline value) names pull_request or push. */
function namesPrOrPush(lines: string[]): boolean {
  const onIdx = lines.findIndex((l) => /^(["']?on)["']?\s*:/m.test(l));
  if (onIdx === -1) return false;
  if (/\b(pull_request|push)\b/.test(lines[onIdx]!.slice(lines[onIdx]!.indexOf(":") + 1))) return true;
  for (let i = onIdx + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.trim() === "") continue;
    if (!/^\s/.test(l)) break; // back to a top-level key: the on-block ended
    if (/\b(pull_request|push)\b/.test(l)) return true;
  }
  return false;
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
        // Forward slashes: the documented finding-path convention, so Windows output matches Linux.
        file: path.relative(root, file).split(path.sep).join("/"),
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
