// T3 scaffold (test-first, plan.md §T3.1–T3.2): asserts how the Zod 4 scan flags
// test/fixtures/zod3-app. The Zod migration (src/migrations.ts getMigration, the
// zod-v4 registry entry, src/rules/zod-v4.ts) lands in T1/T3.3-T3.4, so these
// tests fail on main for the RIGHT reason (no zod-v4 migration), not a syntax
// error. typecheck stays green because the unresolvable import is confined here
// and deferred through a dynamic import cast through unknown.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Finding } from "../src/types.js";
import { scanAndFix } from "../src/scan.js";

// T1 will export getMigration from src/migrations.ts. Until then the module does
// not exist. Lazy-probe it on first use: the top level stays green, and the suite
// fails inside a test with "zod-v4 migration not available yet: getMigration lands
// in T1" — the correct failure mode for a scaffold ahead of its dependency.
let migration: ((id: string) => unknown) | undefined;
async function loadMigration(): Promise<(id: string) => unknown> {
  if (!migration) {
    const mod = await import("../src/migrations.js").catch(() => ({ getMigration: undefined }));
    migration = mod.getMigration;
  }
  if (!migration) throw new Error("zod-v4 migration not available yet: getMigration lands in T1");
  return migration;
}

/** The fixture and its expected (post-auto-fix) tree. */
const fixture = path.join(import.meta.dirname, "fixtures/zod3-app");
const expected = path.join(import.meta.dirname, "fixtures/zod3-app.expected");

/** Scan a copy of the fixture with the Zod migration; findings normalised to /. */
async function zodScan(): Promise<Finding[]> {
  const m = (await loadMigration())("zod-v4") as {
    scan: (root: string) => { result: { findings: Finding[] } };
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-zod-scan-"));
  fs.cpSync(fixture, dir, { recursive: true });
  const rel = (f: string) => path.relative(dir, f).replace(/\\/g, "/");
  return m.scan(dir).result.findings.map((f) => ({ ...f, file: rel(f.file) }));
}

/** Every "file:line -> marker id" expectation, read from the FLAG/OK markers. */
function markers(kind: "FLAG" | "OK"): Array<{ file: string; line: number; id: string }> {
  const out: Array<{ file: string; line: number; id: string }> = [];
  for (const d of fs.readdirSync(path.join(fixture, "src"), { withFileTypes: true })) {
    if (!d.isFile()) continue;
    const text = fs.readFileSync(path.join(fixture, "src", d.name), "utf8");
    text.split("\n").forEach((line, i) => {
      const m = line.match(new RegExp(`//\\s*${kind}\\s+(R\\d(?:-[A-Za-z]+)?)`));
      if (m) out.push({ file: `src/${d.name}`, line: i + 1, id: m[1] });
    });
  }
  return out;
}

describe("zod v4 scan", () => {
  // R4's nativeEnum FLAG (schemas.ts) only counts when T2 row 11 passed (zod 4
  // supports nativeEnum keys). T2 flips this; it defaults to false so the scaffold
  // is self-consistent until the oracle reports back.
  const ZOD_NATIVE_ENUM_SUPPORTED = false;

  it("finds every FLAG line and flags no OK line", async () => {
    const findings = await zodScan();
    const at = (file: string, line: number) => findings.find((f) => f.file === file && f.line === line);
    for (const m of markers("FLAG")) {
      // The R4-nativeEnum FLAG only applies when T2 row 11 passed (zod 4 supports
      // nativeEnum keys); it lives on schemas.ts.
      if (m.id === "R4-nativeEnum" && !ZOD_NATIVE_ENUM_SUPPORTED) continue;
      expect(at(m.file, m.line), `expected a finding on ${m.file}:${m.line} (${m.id})`).toBeDefined();
    }
    for (const m of markers("OK")) {
      expect(at(m.file, m.line), `no finding expected on OK line ${m.file}:${m.line} (${m.id})`).toBeUndefined();
    }
  });

  it("carries the severity + fix kind from the T3.3 table", async () => {
    const findings = await zodScan();
    const rule = (id: string) => findings.filter((f) => f.ruleId === id);
    const kinds: Array<[string, Finding["severity"], Finding["fix"]]> = [
      ["zod-default-then-optional", "silent", "auto"],
      ["zod-default-through-transform", "silent", "auto"],
      ["zod-uuid-strict", "silent", "auto"],
      ["zod-record-exhaustive", "silent", "auto"],
      ["zod-unknown-key-required", "silent", "auto"],
      ["zod-coerce-missing-key", "silent", "manual"],
      ["zod-intersection-error", "silent", "manual"],
      ["zod-errors-property", "break", "auto"],
    ];
    for (const [id, sev, fix] of kinds) {
      for (const f of rule(id)) {
        expect(f.severity, `${id} severity`).toBe(sev);
        expect(f.fix, `${id} fix`).toBe(fix);
      }
    }
  });

  it("auto fixes: src/* land in zod3-app.expected/ and the root files stay byte-identical", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-zod-fix-"));
    fs.cpSync(fixture, dir, { recursive: true });
    // T1's scanAndFix(dir, m) runs the migration's scan + applyAutoFixes; on main
    // scanAndFix only takes one argument, so pass the migration through a cast.
    // Cast through unknown so the call typechecks both before and after T1 adds
    // the (root, migration) overload.
    const m = await loadMigration();
    await (scanAndFix as unknown as (dir: string, m: unknown) => Promise<unknown>)(
      dir,
      m("zod-v4"),
    );
    const read = (rel: string) => fs.readFileSync(path.join(dir, rel), "utf8");
    for (const f of fs.readdirSync(path.join(expected, "src"), { withFileTypes: true })) {
      if (!f.isFile()) continue;
      expect(read(`src/${f.name}`), `src/${f.name} should match the expected file`).toBe(
        fs.readFileSync(path.join(expected, "src", f.name), "utf8"),
      );
    }
    // package.json + tsconfig.json are never rewritten; byte-identical.
    expect(read("package.json")).toBe(fs.readFileSync(path.join(expected, "package.json"), "utf8"));
    expect(read("tsconfig.json")).toBe(fs.readFileSync(path.join(expected, "tsconfig.json"), "utf8"));
  });
});
