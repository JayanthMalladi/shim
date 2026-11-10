import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Finding } from "../src/types.js";
import { getMigration } from "../src/migrations.js";
import { scanAndFixWith, scanWith } from "../src/scan.js";

/** The fixture and its expected (post-auto-fix) tree. */
const fixture = path.join(import.meta.dirname, "fixtures/express4-app");
const expected = path.join(import.meta.dirname, "fixtures/express4-app.expected");

/** Rule id -> the marker ids that belong to it. */
const RULE_MARKER: Record<string, string[]> = {
  "express-splat-param": ["E1", "E1-param"],
  "express-optional-param": ["E1-optional"],
  "express-regex-param": ["E1-regex"],
  "express-literal-special": ["E1-literal"],
  "express-urlencoded-extended": ["E3"],
  "express-query-parser": ["E2"],
  "express-body-parser": ["E4"],
  "express-status-code": ["E5"],
  "express-req-host": ["E6"],
  "express-clearcookie-maxage": ["E7"],
};

/** Scan a copy of the fixture with the Express migration; findings normalised to /. */
function expressScan(): Finding[] {
  const m = getMigration("express-v5");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-express-scan-"));
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
      const m = line.match(new RegExp(`//\\s*${kind}\\s+(E\\d(?:-[a-z]+)?)`));
      if (m) out.push({ file: `src/${d.name}`, line: i + 1, id: m[1] });
    });
  }
  return out;
}

describe("express v5 scan", () => {
  it("asserts exact (file, line) findings per rule: no extras, none missing", async () => {
    const findings = await expressScan();
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
    const findings = await expressScan();
    const at = (file: string, line: number) => findings.find((f) => f.file === file && f.line === line);
    for (const m of markers("FLAG")) {
      expect(at(m.file, m.line), `expected a finding on ${m.file}:${m.line} (${m.id})`).toBeDefined();
    }
    for (const m of markers("OK")) {
      expect(at(m.file, m.line), `no finding expected on OK line ${m.file}:${m.line} (${m.id})`).toBeUndefined();
    }
  });

  it("carries the severity + fix kind from the E-rule table", async () => {
    const findings = await expressScan();
    const rule = (id: string) => findings.filter((f) => f.ruleId === id);
    const kinds: Array<[string, Finding["severity"], Finding["fix"]]> = [
      // E1 splats: auto only when the handler does not read the splat param, else agent.
      ["express-splat-param", "break", "agent"], // mixed; assert the per-line kind below
      ["express-optional-param", "break", "agent"],
      ["express-regex-param", "break", "agent"],
      ["express-literal-special", "break", "agent"],
      ["express-urlencoded-extended", "silent", "auto"],
      ["express-query-parser", "silent", "auto"],
      ["express-body-parser", "silent", "manual"],
      ["express-status-code", "silent", "manual"],
      ["express-req-host", "silent", "manual"],
      ["express-clearcookie-maxage", "silent", "manual"],
    ];
    for (const [id, sev, fix] of kinds) {
      expect(rule(id).length, `${id} found at least one`).toBeGreaterThan(0);
      for (const f of rule(id)) {
        expect(f.severity, `${id} severity`).toBe(sev);
        if (id === "express-splat-param") {
          // The bare `'*'` splats are auto; the one that reads req.params[0] is agent.
          expect(f.fix === "auto" || f.fix === "agent", `${id} fix`).toBe(true);
        } else {
          expect(f.fix, `${id} fix`).toBe(fix);
        }
      }
    }
    // The splat that reads req.params[0] must be agent, not auto.
    const splat = rule("express-splat-param");
    expect(splat.some((f) => f.fix === "agent")).toBe(true);
    expect(splat.some((f) => f.fix === "auto")).toBe(true);
  });

  it("E9 and E10 flag the package.json (related packages + Node floor)", async () => {
    const findings = await expressScan();
    expect(findings.some((f) => f.ruleId === "express-related-package" && f.message.includes("express-rate-limit"))).toBe(true);
    expect(findings.some((f) => f.ruleId === "express-node-floor")).toBe(true);
  });

  it("auto fixes: src/* land in express4-app.expected/ and the root files stay byte-identical", async () => {
    const m = getMigration("express-v5");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-express-fix-"));
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
