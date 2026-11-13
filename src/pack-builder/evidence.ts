/**
 * S06 step 1: the deterministic evidence stage. No model, no target-repo. It downloads two majors
 * of a package with `npm pack` (a download of a published tarball — it installs nothing and runs
 * no lifecycle scripts), unpacks them, and diffs the exported `.d.ts` surface: which top-level
 * exports were removed or added, and which kept their name but changed signature (including a
 * class/interface losing a member, which is how `ZodError.errors` and `res.sendfile` surface).
 *
 * The changelog / migration-guide text is passed in as `--changelog <file>`; it is not fetched
 * here (a Haiku agent fetches it separately). `buildEvidence` combines the two into evidence.json.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { run } from "../exec.js";
import type { Evidence, Surface, SurfaceDiff, SurfaceExport } from "./types.js";

/**
 * Download one version's tarball into outDir and unpack it. `npm pack <pkg>@<ver>` writes the
 * tgz to `--pack-destination`; the archive's root is `package/`. Returns that root.
 * A download — not an install: no `--ignore-scripts` needed because nothing is executed, but we
 * pass it anyway so the intent is explicit and a stray local override can't inject a script.
 */
export function packPackage(pkg: string, version: string, outDir: string): string {
  const work = path.join(outDir, `${pkg.replace("@", "").replace("/", "-")}-${version}`);
  fs.mkdirSync(work, { recursive: true });
  const dest = path.join(work, "tgz");
  fs.mkdirSync(dest, { recursive: true });
  const pack = run("npm", ["pack", `${pkg}@${version}`, "--pack-destination", dest, "--ignore-scripts"], work, 5 * 60_000);
  if (!pack.ok) throw new Error(`npm pack ${pkg}@${version} failed: ${pack.output.slice(-500)}`);
  const tgz = fs.readdirSync(dest).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`no tarball from npm pack ${pkg}@${version}`);
  const root = path.join(work, "package");
  const ex = run("tar", ["-xzf", path.join(dest, tgz), "-C", root, "--strip-components", "1"], work, 2 * 60_000);
  if (!ex.ok || !fs.existsSync(root)) throw new Error(`tar extract of ${pkg}@${version} failed: ${ex.output.slice(-300)}`);
  return root;
}

/** The .d.ts files a package ships: every `*.d.ts` under the package root, node_modules excluded. */
function dtsFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".d.ts")) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** A file's normalized top-level export surface, following intra-package `export * from` / `export … from`. */
function surfaceForDir(root: string, version: string): Surface {
  const files = dtsFiles(root);
  const seen = new Set<string>();
  const out: SurfaceExport[] = [];
  const add = (e: SurfaceExport) => {
    if (seen.has(e.name)) return;
    seen.add(e.name);
    out.push(e);
  };
  for (const f of files) collectExports(f, root, out, 0, new Set());
  // De-dupe by name, keeping the first. Sort for a stable diff.
  const dedup = new Map<string, SurfaceExport>();
  for (const e of out) if (!dedup.has(e.name)) dedup.set(e.name, e);
  return { version, files: files.map((f) => path.relative(root, f)), exports: [...dedup.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

/**
 * Top-level exported symbols of one .d.ts, resolving re-exports within the package. Each export
 * carries its normalized declaration text; classes and interfaces also fold in a sorted
 * "members: …" summary, so a type that loses a member counts as a changed signature.
 */
function collectExports(file: string, root: string, out: SurfaceExport[], depth: number, visited: Set<string>): void {
  if (visited.has(file) || depth > 4) return;
  visited.add(file);
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  for (const st of sf.statements) {
    // A re-export: `export * from "mod"` or `export { a, b } from "mod"` — follow it within the package.
    if (ts.isExportDeclaration(st) && st.moduleSpecifier) {
      const spec = st.moduleSpecifier.getText();
      const targets = resolveModule(root, file, spec);
      if (!st.exportClause) for (const t of targets) collectExports(t, root, out, depth + 1, visited);
      else if (ts.isNamedExports(st.exportClause))
        for (const n of st.exportClause.elements) for (const t of targets) exportNamedFrom(t, root, n.name.getText(), out, depth, visited);
      continue;
    }
    if (!isExported(st)) continue;
    const rel = path.relative(root, file).split(path.sep).join("/");
    const emit = (name: string, signature: string) => out.push({ name, signature, file: rel });
    if (ts.isFunctionDeclaration(st) && st.name) emit(st.name.text, declText(st));
    else if (ts.isClassDeclaration(st) && st.name) emit(st.name.text, classText(st));
    else if (ts.isInterfaceDeclaration(st) && st.name) emit(st.name.text, ifaceText(st));
    else if (ts.isTypeAliasDeclaration(st) && st.name) emit(st.name.text, declText(st));
    else if (ts.isEnumDeclaration(st) && st.name) emit(st.name.text, declText(st));
    else if (ts.isModuleDeclaration(st) && st.name) emit(st.name.getText(), "namespace");
    else if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) emit(d.name.text, declText(d));
  }
}

/** A statement carries the `export` keyword (declaration modifiers live on the statement base). */
function isExported(st: ts.Statement): boolean {
  const mod = (st as { modifiers?: readonly ts.ModifierLike[] }).modifiers;
  return !!mod?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function exportNamedFrom(target: string, root: string, name: string, out: SurfaceExport[], depth: number, visited: Set<string>) {
  const tmp: SurfaceExport[] = [];
  collectExports(target, root, tmp, depth, visited);
  const hit = tmp.find((e) => e.name === name);
  if (hit) out.push(hit);
}

/** A module specifier ("./internal.js", "zod/lib/index") to the file(s) it resolves to, within root. */
function resolveModule(root: string, fromFile: string, spec: string): string[] {
  const fromDir = path.dirname(fromFile);
  const base = path.resolve(fromDir, spec);
  const cands = [
    base,
    base.replace(/\.js$/, ".d.ts"),
    path.join(base, "index.d.ts"),
    base + ".d.ts",
    path.join(root, "node_modules", spec, "index.d.ts"),
  ];
  return cands.filter((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

const norm = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\s+/g, " ").trim();

function declText(node: ts.Node): string {
  return node.kind === 161 ? "export default" : truncate(node.getText(), 240);
}
function classText(c: ts.ClassDeclaration): string {
  const members = c.members.map((m) => memberName(m)).filter(Boolean).sort();
  return truncate(`${c.name!.text} { ${members.join(" | ")} }`, 320);
}
function ifaceText(i: ts.InterfaceDeclaration): string {
  const members = i.members.map((m) => memberName(m)).filter(Boolean).sort();
  return truncate(`${i.name!.text} { ${members.join(" | ")} }`, 320);
}
function memberName(m: ts.TypeElement | ts.ClassElement): string {
  if (ts.isPropertySignature(m) || ts.isPropertyDeclaration(m) || ts.isMethodDeclaration(m) || ts.isMethodSignature(m))
    return m.name ? m.name.getText() : "";
  return "";
}
const truncate = (s: string, n: number) => {
  const t = norm(s);
  return t.length > n ? t.slice(0, n) + "…" : t;
};

/** The deterministic diff: removed / added / changed between two surfaces. */
export function diffSurfaces(from: Surface, to: Surface): SurfaceDiff {
  const byName = new Map(to.exports.map((e) => [e.name, e]));
  const fromBy = new Map(from.exports.map((e) => [e.name, e]));
  const removed: SurfaceExport[] = [];
  const changed: SurfaceDiff["changed"] = [];
  for (const f of from.exports) {
    const t = byName.get(f.name);
    if (!t) removed.push(f);
    else if (t.signature !== f.signature) changed.push({ name: f.name, fromSig: f.signature, toSig: t.signature, file: t.file });
  }
  const added = to.exports.filter((e) => !fromBy.has(e.name));
  return { removed, added, changed };
}

export function surfaceOfVersion(root: string, version: string): Surface {
  return surfaceForDir(root, version);
}

/**
 * evidence.json for one package between two majors: unpack both, diff the exported surface, and
 * carry the changelog text verbatim (truncated) so the draft stage has the library's own words.
 */
export function buildEvidence(opts: { package: string; from: string; to: string; changelog?: string; outDir: string; keep?: boolean }): Evidence {
  const work = path.join(opts.outDir, "evidence");
  fs.mkdirSync(work, { recursive: true });
  const fromDir = packPackage(opts.package, opts.from, work);
  const toDir = packPackage(opts.package, opts.to, work);
  const fromSurface = surfaceOfVersion(fromDir, opts.from);
  const toSurface = surfaceOfVersion(toDir, opts.to);
  const changelog = opts.changelog ? opts.changelog : undefined;
  const evidence: Evidence = {
    package: opts.package,
    from: opts.from,
    to: opts.to,
    fromSurface,
    toSurface,
    diff: diffSurfaces(fromSurface, toSurface),
    changelog: changelog ? truncate(changelog, 40000) : undefined,
    fromDir,
    toDir,
  };
  if (!opts.keep) {
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {}
  }
  return evidence;
}

/** Keep the unpacked tarballs (for inspection / the H2 type-diff check) instead of deleting them. */
export const _tmpRoot = os.tmpdir; // re-export os for callers needing a stable tmp base
