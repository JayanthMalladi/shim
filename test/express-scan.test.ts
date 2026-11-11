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

/**
 * Rule id -> the marker ids that belong to it. express-async-errors has no marker: the finding lands
 * on the bare `require(...)` statement, and the fixture keeps that line comment-free (ts-morph's
 * replaceWithText("") chokes on a statement that carries a trailing comment), so its FLAG E8 sits on
 * the line ABOVE and is never captured by the trailing-comment scan.
 */
const RULE_MARKER: Record<string, string[]> = {
  "express-splat-param": ["E1", "E1-dead", "E1-ref", "E1-constrained"],
  "express-optional-param": ["E1-optional"],
  "express-regex-param": ["E1-regex"],
  "express-literal-special": ["E1-literal"],
  "express-urlencoded-extended": ["E3"],
  "express-query-parser": ["E2"],
  "express-body-parser": ["E4"],
  "express-status-code": ["E5"],
  "express-req-host": ["E6"],
  "express-clearcookie-maxage": ["E7"],
  "express-sendfile": ["E11"],
  "express-async-errors": [],
};

/** Scan a copy of the fixture with the Express migration; findings normalised to /. */
function expressScan(): Finding[] {
  const m = getMigration("express-v5");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-express-scan-"));
  fs.cpSync(fixture, dir, { recursive: true });
  const { result } = scanWith(dir, m);
  return result.findings.map((f) => ({ ...f, file: f.file.replace(/\\/g, "/") }));
}

/**
 * Every "file:line -> marker id" expectation, read from the trailing FLAG/OK markers. A marker only
 * counts when there is code before the `//` on that line; a marker on a bare comment line (the
 * express-async-errors `// FLAG E8` sits above the require it annotates) is not machine-captured.
 */
function markers(kind: "FLAG" | "OK"): Array<{ file: string; line: number; id: string }> {
  const out: Array<{ file: string; line: number; id: string }> = [];
  for (const d of fs.readdirSync(path.join(fixture, "src"), { withFileTypes: true })) {
    if (!d.isFile()) continue;
    const text = fs.readFileSync(path.join(fixture, "src", d.name), "utf8");
    text.split("\n").forEach((line, i) => {
      const m = line.match(new RegExp(`//\\s*${kind}\\s+(E\\d+(?:-[a-z]+)?)`));
      if (m && line.slice(0, m.index).trim()) out.push({ file: `src/${d.name}`, line: i + 1, id: m[1] });
    });
  }
  return out;
}

describe("express v5 scan", () => {
  it("asserts exact (file, line) findings per rule: no extras, none missing", async () => {
    const findings = await expressScan();
    for (const [ruleId, markerIds] of Object.entries(RULE_MARKER)) {
      if (!markerIds.length) continue; // markerless rule (express-async-errors): asserted in the kinds test below
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
    // The bare splats auto-rewrite; a referenced handler, a dead route, or a ':name(*)' constraint does not.
    const splatFix: Record<string, Finding["fix"]> = {
      "src/app.ts:14": "auto", // bare '*'
      "src/app.ts:15": "auto", // '/x/*'
      "src/app.ts:16": "manual", // '/(.*)' dead route: leave it
      "src/app.ts:17": "agent", // '/api/*' referenced handler
      "src/routes.js:10": "auto", // bare '*'
      "src/routes.js:13": "agent", // '/files/:path(*)' constrained splat
    };
    const kinds: Array<[string, Finding["severity"], Finding["fix"]]> = [
      ["express-splat-param", "break", "agent"], // mixed auto/agent/manual; assert the per-line kind below
      ["express-optional-param", "break", "auto"], // a standard '/user/:id?/edit' auto-rewrites to '{/:id}'
      ["express-regex-param", "break", "agent"],
      ["express-literal-special", "break", "agent"],
      ["express-urlencoded-extended", "silent", "auto"],
      ["express-query-parser", "silent", "auto"],
      ["express-body-parser", "silent", "manual"],
      ["express-status-code", "silent", "manual"],
      ["express-req-host", "silent", "manual"],
      ["express-clearcookie-maxage", "silent", "manual"],
      ["express-sendfile", "break", "agent"],
      // express-async-errors has no trailing marker (the require line stays comment-free), so it is
      // not in RULE_MARKER and is asserted marker-free here.
      ["express-async-errors", "break", "auto"],
    ];
    for (const [id, sev, fix] of kinds) {
      expect(rule(id).length, `${id} found at least one`).toBeGreaterThan(0);
      for (const f of rule(id)) {
        expect(f.severity, `${id} severity`).toBe(sev);
        const key = `${f.file}:${f.line}`;
        if (id === "express-splat-param") expect(splatFix[key], `splat ${key} fix kind is asserted`).toBe(f.fix);
        else expect(f.fix, `${id} fix`).toBe(fix);
      }
    }
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

/**
 * E6.1: the query-parser insert must only follow a call to the express default/namespace binding
 * (`const app = express()`), whose `.set` exists. A bare `Router()` / `express.Router()` has no `.set`
 * (express 5.3.0: `typeof Router().set === "undefined"`), so the insert must not be queued there —
 * it is reported as manual instead.
 */
describe("query-parser insert is app-creation-only (no router.set crash)", () => {
  const m = getMigration("express-v5");
  const scanDir = (files: Record<string, string>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-e6-qp-"));
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    for (const [rel, text] of Object.entries(files)) {
      if (rel.startsWith("src/")) fs.writeFileSync(path.join(dir, rel), text);
      else fs.writeFileSync(path.join(dir, rel), text);
    }
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", private: true, dependencies: { express: "^4.21.0" } }));
    const { result } = scanWith(dir, m);
    return { dir, findings: result.findings };
  };

  it("a Router-only file reports manual and queues no .set edit", async () => {
    const routerOnly = `import { Router } from "express";
const router = Router();
router.get("/search", (req, res) => res.json(req.query.q));
module.exports = router;
`;
    const { dir, findings } = scanDir({ "src/route.js": routerOnly });
    const qp = findings.filter((f) => f.ruleId === "express-query-parser");
    expect(qp).toHaveLength(1);
    expect(qp[0]!.fix).toBe("manual");
    // No edit is queued: applying auto fixes leaves the router file byte-identical.
    await scanAndFixWith(dir, m);
    expect(fs.readFileSync(path.join(dir, "src/route.js"), "utf8")).toBe(routerOnly);
  });

  it("a const app = express() file still gets the .set insert", async () => {
    const appFile = `import express from "express";
const app = express();
app.get("/search", (req, res) => res.json(req.query.q));
export default app;
`;
    const { dir, findings } = scanDir({ "src/app.js": appFile });
    const qp = findings.filter((f) => f.ruleId === "express-query-parser");
    expect(qp).toHaveLength(1);
    expect(qp[0]!.fix).toBe("auto");
    await scanAndFixWith(dir, m);
    expect(fs.readFileSync(path.join(dir, "src/app.js"), "utf8")).toContain("app.set('query parser', 'extended');");
  });
});
