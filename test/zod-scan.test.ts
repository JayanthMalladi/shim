// T3 scaffold (test-first, plan.md §T3.1–T3.2): asserts how the Zod 4 scan flags
// test/fixtures/zod3-app. The Zod migration (getMigration("zod-v4"), the MIGRATIONS
// registry entry, src/rules/zod-v4.ts) lands with T1, so these tests fail on main
// for the RIGHT reason: getMigration("zod-v4") throws "unknown migration". A later
// task (T3.4/T4) registers zod-v4 in MIGRATIONS and copies src/rules/zod-v4.ts into
// the main tree; then this suite compiles and passes as written here.
//
// Findings: one per FLAG/OK marker. Markers are trailing `// FLAG R<n> ...` /
// `// OK R<n> ...` comments on the CODE line the rule's finding lands on (node
// start line, per scanZodV4's add()). markers() reads the marker from the same
// line it documents, so per-rule (file, line) finding sets equal the FLAG sets.
//
// R4-nativeEnum: zod 4 supports nativeEnum keys (T2 row 11 confirmed), and
// scanZodV4 treats nativeEnum as exhaustive unconditionally — so the R4-nativeEnum
// FLAG marker is always asserted; the former ZOD_NATIVE_ENUM_SUPPORTED skip flag
// is removed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Finding } from "../src/types.js";
import { getMigration } from "../src/migrations.js";
import { scanAndFixWith, scanWith } from "../src/scan.js";

/** The fixture and its expected (post-auto-fix) tree. */
const fixture = path.join(import.meta.dirname, "fixtures/zod3-app");
const expected = path.join(import.meta.dirname, "fixtures/zod3-app.expected");

/** Rule id -> marker ids that belong to it (R4-nativeEnum counts under zod-record-exhaustive). */
const RULE_MARKER: Record<string, string[]> = {
  "zod-default-then-optional": ["R1"],
  "zod-default-through-transform": ["R2"],
  "zod-uuid-strict": ["R3"],
  "zod-record-exhaustive": ["R4", "R4-nativeEnum"],
  "zod-unknown-key-required": ["R5"],
  "zod-coerce-missing-key": ["R6"],
  "zod-intersection-error": ["R7"],
  "zod-errors-property": ["R8"],
  "zod-object-default": ["R9"],
};

/** Scan a copy of the fixture with the Zod migration; findings normalised to /. */
function zodScan(): Finding[] {
  const m = getMigration("zod-v4");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-zod-scan-"));
  fs.cpSync(fixture, dir, { recursive: true });
  const { result } = scanWith(dir, m);
  return result.findings.map((f) => ({ ...f, file: f.file.replace(/\\/g, "/") }));
}

/** Every "file:line -> marker id" expectation, read from the trailing FLAG/OK markers. */
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
  it("asserts exact (file, line) findings per rule: no extras, none missing", async () => {
    const findings = await zodScan();
    for (const [ruleId, markerIds] of Object.entries(RULE_MARKER)) {
      const expected = new Set(
        markers("FLAG")
          .filter((m) => markerIds.includes(m.id))
          .map((m) => `${m.file}:${m.line}`),
      );
      const actual = new Set(findings.filter((f) => f.ruleId === ruleId).map((f) => `${f.file}:${f.line}`));
      for (const e of expected) {
        expect(actual.has(e), `${ruleId}: missing expected finding ${e}`).toBe(true);
      }
      for (const a of actual) {
        expect(expected.has(a), `${ruleId}: extra finding ${a} not marked as FLAG`).toBe(true);
      }
      expect(expected.size, `${ruleId} has at least one FLAG marker`).toBeGreaterThan(0);
    }
  });

  it("finds every FLAG line and flags no OK line", async () => {
    const findings = await zodScan();
    const at = (file: string, line: number) => findings.find((f) => f.file === file && f.line === line);
    for (const m of markers("FLAG")) {
      expect(at(m.file, m.line), `expected a finding on ${m.file}:${m.line} (${m.id})`).toBeDefined();
    }
    for (const m of markers("OK")) {
      expect(at(m.file, m.line), `no finding expected on OK line ${m.file}:${m.line} (${m.id})`).toBeUndefined();
    }
  });

  it("does not throw on the imported-identifier / two-const cycle fixture", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-zod-crash-"));
    fs.cpSync(fixture, dir, { recursive: true });
    const m = getMigration("zod-v4");
    let threw: unknown;
    try {
      scanWith(dir, m);
    } catch (err) {
      threw = err;
    }
    // src/imported-key.ts imports `uuidId` (no initializer -> isZodChain would recurse
    // on itself forever) and holds a two-const cycle. The scan must finish, not RangeError.
    expect(threw, `scan threw on the cycle/imported-key fixture: ${String(threw)}`).toBeUndefined();
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
      ["zod-object-default", "silent", "auto"],
    ];
    for (const [id, sev, fix] of kinds) {
      expect(rule(id).length, `${id} found at least one`).toBeGreaterThan(0);
      for (const f of rule(id)) {
        expect(f.severity, `${id} severity`).toBe(sev);
        expect(f.fix, `${id} fix`).toBe(fix);
      }
    }
  });

  it("auto fixes: src/* land in zod3-app.expected/ and the root files stay byte-identical", async () => {
    const m = getMigration("zod-v4");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-zod-fix-"));
    fs.cpSync(fixture, dir, { recursive: true });
    await scanAndFixWith(dir, m);
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
