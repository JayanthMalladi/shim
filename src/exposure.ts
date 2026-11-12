/**
 * The one-step exposure report: `shim scan .` with no --migration. Model-free and
 * network-free — it reads the pins, runs every matching migration's static scan, and
 * writes the report. The only subprocess in the whole path is the local `git`
 * `ls-files` / `rev-parse` that loadProject's source-file list uses (src/scan.ts); no
 * package manager is ever run. Lockfiles are read as plain text / JSON.
 *
 * This module deliberately imports only from scan.js (whose only subprocess is local
 * git), types.js and migrations.js — never exec.js / agent.js / node:http, so a
 * stray import is a reviewable diff, not a silent dependency.
 */
import fs from "node:fs";
import path from "node:path";
import type { Finding, ScanResult, Severity } from "./types.js";
import type { Migration } from "./migrations.js";
import { MIGRATIONS } from "./migrations.js";
import { findPackageJsons, loadProject, readJson } from "./scan.js";

/** The package name each migration's pack scans for (mirrors each entry's findPackages target). */
const MIG_DEP: Record<Migration["id"], string> = { "ai-sdk-v7": "ai", "zod-v4": "zod", "express-v5": "express" };
/** The migration's new major: what "already upgraded" means for the section label. */
const NEW_MAJOR: Record<Migration["id"], number> = { "ai-sdk-v7": 7, "zod-v4": 4, "express-v5": 5 };
/** The dependency fields a pin can be declared in; mirrors findPackages. */
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies"] as const;
const SEVERITY_ORDER: Severity[] = ["silent", "break", "deprecated"];

export interface Pin {
  /** The package.json that declares it, relative to the scan root, forward slashes. */
  file: string;
  pkg: string;
  field: string;
  /** The declared range, verbatim (incl. workspace: / catalog: / *). */
  range: string;
  /** The installed version read from the lockfile, when one exists. */
  installed?: string;
}

export interface Section {
  kind: "covered" | "upgraded";
  migration: Migration;
  findings: Finding[];
}

export interface ExposureReport {
  pins: Pin[];
  /** Which lockfile the installed versions came from, if any. */
  lockfile?: string;
  sections: Section[];
  /** Deps no pack covers, whose range names a major version; deduped, sorted. */
  notCovered: Array<{ pkg: string; range: string }>;
}

/** Every dependency every package.json (root + workspaces; node_modules skipped) declares. */
export function collectPins(root: string): Pin[] {
  const abs = path.resolve(root);
  const pins: Pin[] = [];
  for (const file of findPackageJsons(root)) {
    const pkg = readJson(file);
    if (!pkg) continue;
    const rel = path.relative(abs, file).split(path.sep).join("/");
    for (const field of DEP_FIELDS) {
      const table = pkg[field];
      if (typeof table !== "object" || table === null) continue;
      for (const [name, range] of Object.entries(table)) {
        if (typeof range !== "string") continue;
        pins.push({ file: rel, pkg: name, field, range });
      }
    }
  }
  pins.sort((a, b) => a.file.localeCompare(b.file) || a.pkg.localeCompare(b.pkg));
  return pins;
}

/**
 * The report. Loads one shared ts-morph Project and runs each migration's scan that has
 * at least one pin still on the old major or already on the new major. No network, no model.
 */
export function buildExposureReport(root: string): ExposureReport {
  const abs = path.resolve(root);
  const pins = collectPins(abs);
  const installed = readInstalledVersions(abs);

  // One Project load serves every migration's scan; the scanners are read-only on it.
  let project: ReturnType<typeof loadProject> | undefined;
  const sections: Section[] = [];
  for (const m of Object.values(MIGRATIONS)) {
    if (!m) continue;
    const mine = pins.filter((p) => MIG_DEP[m.id] === p.pkg);
    if (mine.length === 0) continue;
    const oldPins = mine.filter((p) => m.isOldMajor(p.range));
    const newPins = mine.filter((p) => !m.isOldMajor(p.range) && rangeAllowsMajor(p.range, NEW_MAJOR[m.id]));
    // A pin that is neither on the old major nor on the new major (workspace:, catalog:,
    // git:, * — no usable major) is shown in "Pins found" only; we claim no coverage of it.
    if (oldPins.length === 0 && newPins.length === 0) continue;
    project ??= loadProject(abs);
    const ctx = m.scan(project, abs);
    ctx.findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    sections.push({
      migration: m,
      // The old-major case wins the "Covered" slot when both are present: it is the actionable one.
      kind: oldPins.length ? "covered" : "upgraded",
      findings: ctx.findings,
    });
  }

  for (const p of pins) p.installed = installed?.versions.get(p.pkg);

  const coveredNames = new Set(Object.values(MIGRATIONS).filter(Boolean).map((m) => MIG_DEP[m!.id]));
  const seen = new Set<string>();
  const notCovered: Array<{ pkg: string; range: string }> = [];
  for (const p of pins) {
    if (coveredNames.has(p.pkg)) continue;
    if (!/[0-9]/.test(p.range)) continue; // no major version named: not a "major-version range"
    if (seen.has(p.pkg)) continue;
    seen.add(p.pkg);
    notCovered.push({ pkg: p.pkg, range: p.range });
  }
  notCovered.sort((a, b) => a.pkg.localeCompare(b.pkg));

  return { pins, lockfile: installed?.name, sections, notCovered };
}

/** The report, as the string `scan .` prints and `--out` writes. */
export function renderReport(r: ExposureReport): string {
  const L: string[] = ["# Shim exposure report", ""];

  L.push("## Pins found", "");
  if (r.pins.length === 0) {
    L.push("No dependencies found in any package.json.", "");
  } else {
    let cur: string | undefined;
    for (const p of r.pins) {
      if (p.file !== cur) {
        cur = p.file;
        L.push(`**${p.file}**`);
      }
      const short = p.field === "dependencies" ? "" : ` (${p.field.slice(0, 3)})`;
      const inst = p.installed ? ` — installed ${p.installed}` : "";
      L.push(`- ${p.pkg} ${p.range}${short}${inst}`);
    }
    L.push("");
  }

  for (const s of r.sections) {
    L.push(
      s.kind === "covered"
        ? `## Covered: ${s.migration.title} (${s.migration.id})`
        : `## Upgraded, but code may still use the old API: ${s.migration.title} (${s.migration.id})`,
      ""
    );
    const bySev = groupBySeverity(s.findings);
    if (s.findings.length === 0) L.push("No findings.", "");
    for (const sev of SEVERITY_ORDER) {
      const fs_ = bySev[sev];
      if (fs_.length === 0) continue;
      L.push(`### ${sev}`, "");
      for (const f of fs_) L.push(`- ${f.file}:${f.line} [${f.ruleId}] ${f.message}`);
      L.push("");
    }
  }

  L.push("## Not covered yet", "");
  if (r.notCovered.length === 0) L.push("Every dependency with a major-version range is covered by a pack above.", "");
  else {
    L.push(
      "No Shim rules for these packages yet: " +
        r.notCovered.map((p) => `${p.pkg} (${p.range})`).join(", ") +
        "."
    );
    L.push("");
  }

  L.push(
    "No code left your machine, no model was called, and no network request was made; " +
      "this report reads your repo and its lockfile" +
      (r.lockfile ? `s (${r.lockfile})` : "") +
      " only."
  );
  const fixable = r.sections.filter((s) => s.findings.length > 0);
  if (fixable.length > 0) {
    L.push("");
    for (const s of fixable) L.push(`To fix: npx getshim fix . --migration ${s.migration.id}`);
  }
  return L.join("\n");
}

/** The exact per-line + summary the `--migration` scan has always printed; the golden test renders through it. */
export function formatFindings(result: ScanResult): string {
  const lines = result.findings.map((f) => `${f.file}:${f.line}  ${f.severity}/${f.fix}  [${f.ruleId}]  ${f.message}`);
  lines.push("");
  lines.push(`${result.findings.length} findings in ${result.filesScanned} files`);
  return lines.join("\n");
}

function groupBySeverity(findings: Finding[]): Record<Severity, Finding[]> {
  const out: Record<Severity, Finding[]> = { silent: [], break: [], deprecated: [] };
  for (const f of findings) out[f.severity].push(f);
  return out;
}

/**
 * Inlined from bump.js on purpose: exposure.ts must not import bump.js, because bump.js
 * imports exec.js's `run` (a subprocess runner). This range helper is pure.
 */
function rangeAllowsMajor(range: string, major: number): boolean {
  return range.split("||").some((part) => {
    const p = part.trim();
    if (p === "*" || p === "latest" || p === "") return true;
    const m = p.match(/^(>=|>)?\s*[\^~=v]*\s*(\d+)/);
    if (!m) return false;
    const n = Number(m[2]);
    if (!m[1]) return n === major;
    const upper = Number(p.match(/<\s*(\d+)/)?.[1] ?? Infinity);
    return n <= major && major < upper;
  });
}

/** Read the installed version of each direct dep from whichever lockfile exists (never run a manager). */
export function readInstalledVersions(root: string): { name: string; versions: Map<string, string> } | undefined {
  const cands: Array<[string, () => Map<string, string>]> = [
    ["package-lock.json", () => installedNpm(root)],
    ["pnpm-lock.yaml", () => installedPnpm(root)],
    ["yarn.lock", () => installedYarn(root)],
    ["bun.lock", () => installedBun(root)],
  ];
  for (const [name, read] of cands) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    return { name, versions: read() };
  }
  return undefined;
}

/** package-lock.json (npm v2+): the resolved version of a direct dep is under packages["node_modules/<pkg>"]. */
function installedNpm(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const lock = readJson(path.join(root, "package-lock.json"));
  const packages = lock?.packages;
  if (typeof packages !== "object" || packages === null) return out;
  for (const [key, val] of Object.entries(packages)) {
    if (typeof val !== "object" || val === null) continue;
    const nm = key.lastIndexOf("node_modules/");
    const pkg = nm >= 0 ? key.slice(nm + "node_modules/".length) : undefined;
    const version = (val as any).version;
    if (pkg && typeof version === "string" && !out.has(pkg)) out.set(pkg, version);
  }
  return out;
}

/**
 * pnpm-lock.yaml (v9): root and each workspace importer list their direct deps under
 * dependencies / devDependencies / peerDependencies, each with a `version:` line. A tiny
 * indent-aware reader — pnpm generates this with consistent 2-space steps.
 */
function installedPnpm(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const obj = yamlIndentToObj(fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"));
  const sections = ["dependencies", "devDependencies", "peerDependencies"];
  // One pass over the node's own sections plus each workspace importer's sections. No recursion:
  // the importers are the only nodes that carry dependency tables in a pnpm lock.
  const nodes = [obj, ...Object.values<any>(obj.importers ?? {})];
  for (const node of nodes) {
    if (typeof node !== "object" || node === null) continue;
    for (const sec of sections) {
      for (const [name, v] of Object.entries<any>(node[sec] ?? {})) {
        // A dep with peer deps gets a `0.23.2(esbuild@0.28.2)` version; strip the peer tail.
        // A non-resolved entry (`catalog:`, `link:`) is not a version.
        const raw = typeof v?.version === "string" ? v.version.replace(/\(.*$/, "") : undefined;
        if (raw && /^[0-9]/.test(raw) && !out.has(name)) out.set(name, raw);
      }
    }
  }
  return out;
}

/**
 * A tiny indent-based parser for the pnpm-lock.yaml subset we need: nested `key:` / `key: value`
 * scalars only. List items (`- ...`) are skipped (they are the `packages:`/`snapshots:` entries,
 * which we do not need). pnpm emits consistent 2-space indentation.
 */
function yamlIndentToObj(text: string): Record<string, any> {
  const root: Record<string, any> = {};
  // Stack of [indent, container]; a deeper line nests into the current container.
  const stack: Array<{ ind: number; obj: Record<string, any> }> = [{ ind: -1, obj: root }];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#") || raw.trim().startsWith("- ")) continue;
    const ind = raw.length - raw.trimStart().length;
    const m = raw.trim().match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    // pnpm quotes keys that need it (scoped names: '@changesets/parse':) — strip the quotes.
    const key = m[1]!.trim().replace(/^['"]|['"]$/g, "");
    let value = m[2]!.trim();
    while (stack.length > 1 && stack[stack.length - 1]!.ind >= ind) stack.pop();
    const parent = stack[stack.length - 1]!.obj;
    if (value === "" || value === "|" || value === "|-") {
      const child: Record<string, any> = {};
      parent[key] = child;
      stack.push({ ind, obj: child });
    } else {
      parent[key] = value.replace(/^['"]|['"]$/g, "");
    }
  }
  return root;
}

/**
 * yarn.lock (classic v1): an entry header lists one or more `name@range` specs (comma-joined);
 * the resolved version is the first indented `version` line under it.
 */
function installedYarn(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const text = fs.readFileSync(path.join(root, "yarn.lock"), "utf8");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i]!;
    if (!header || /^\s/.test(header) || header.startsWith("#")) continue;
    const specs = (header.split(":")[0] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (specs.length === 0) continue;
    const names = specs.map((s) => s.match(/^(@?[^@]+)@/)?.[1]).filter((n): n is string => !!n);
    if (names.length === 0) continue;
    // The first indented `version` line belonging to this entry. yarn classic writes
    // `version "3.25.76"` (no colon); yarn berry and a hand-authored lock may write
    // `version: 3.25.76`. Match both.
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!;
      if (l.trim() === "") continue;
      if (!/^\s/.test(l)) break; // next entry header: this entry had no version line
      const m = l.match(/^\s+version\s*(?::\s*)?["']?([0-9][^"'\s]*)/);
      if (m) {
        for (const n of names) if (!out.has(n)) out.set(n, m[1]!);
        break;
      }
    }
  }
  return out;
}

/** bun.lock: JSON; the resolved version of a direct dep is under its dependencies/devDependencies entry. */
/**
 * bun.lock (JSON, lockfileVersion 1): `dependencies`/`devDependencies` hold the declared RANGES;
 * the resolved version lives in `packages`, whose entries are arrays whose index 0 is the
 * canonical `<name>@<resolved>` string. A scoped name's own `@` is skipped by using the last `@`.
 */
function installedBun(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const lock = readJson(path.join(root, "bun.lock"));
  const sections = ["dependencies", "devDependencies", "peerDependencies"] as const;
  const direct = new Set<string>();
  const tables: Record<string, any>[] = [lock, ...Object.values<any>(lock?.workspaces ?? {})].filter(
    (t) => typeof t === "object" && t !== null
  );
  for (const t of tables) for (const f of sections) for (const name of Object.keys(t[f] ?? {})) direct.add(name);
  const packages = lock?.packages;
  if (typeof packages !== "object" || packages === null) return out;
  for (const val of Object.values<any>(packages)) {
    if (!Array.isArray(val)) continue;
    const canon = val[0];
    if (typeof canon !== "string") continue;
    const at = canon.lastIndexOf("@");
    if (at <= 0) continue; // no `@version` tail
    const name = canon.slice(0, at);
    const version = canon.slice(at + 1);
    if (direct.has(name) && version && !out.has(name)) out.set(name, version);
  }
  return out;
}
