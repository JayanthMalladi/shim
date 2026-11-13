/**
 * S06 step 3: the deterministic admission harness. A candidate rule is admitted only when, run
 * through the DSL interpreter:
 *   (1) it flags a line of its own FLAG fixture;
 *   (2) it stays silent on its own no-flag fixture;
 *   (3) it stays silent on every other pack's fixtures (the cross-pack negative control); and
 *   (4) running it over all of test/fixtures/ never throws.
 *
 * All checks are model-free and target-repo-free: the candidate's fixtures are plain .ts files in
 * a scratch dir, and the only code that runs is the fixed interpreter over ts-morph. A deliberately
 * broken rule (one that flags the wrong thing) must fail at least one check — that is the whole
 * point of the gate.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Project } from "ts-morph";
import { interpretRule } from "./interpret.js";
import type { Candidate, DslRule, AdmissionResult } from "./types.js";

/** The candidate pack's own fixture files, named so they can't collide with a real pack's. */
const GEN_FLAG_PREFIX = "gen-flag-";
const GEN_NOFLAG_PREFIX = "gen-noflag-";
const genFlagName = (id: string) => `${GEN_FLAG_PREFIX}${id}.ts`;
const genNoFlagName = (id: string) => `${GEN_NOFLAG_PREFIX}${id}.ts`;

/** A scratch project holding one candidate's fixtures plus every other pack's fixture tree. */
function buildProject(dir: string): { project: Project; files: Set<string>; all: string[] } {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true, jsx: 4 },
  });
  const all: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(e.name)) all.push(p);
    }
  };
  walk(dir);
  for (const f of all) project.addSourceFileAtPath(f);
  const files = new Set(all.map((f) => path.relative(dir, f).split(path.sep).join("/")));
  return { project, files, all };
}

/**
 * Write one candidate pack's fixtures into a scratch dir alongside every other pack's fixtures,
 * and admit only the rules that satisfy all four checks. `outDir` is where the candidate pack is
 * being assembled (its __fixtures__/ files are written here, then copied into the harness dir).
 */
export function admitCandidates(cands: Candidate[], otherPackFixtureDirs: string[]): AdmissionResult[] {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "shim-admission-"));
  try {
    // Lay out the candidate's own fixtures + every other pack's tree under one root.
    const root = path.join(work, "root");
    fs.mkdirSync(root, { recursive: true });
    for (const c of cands) {
      fs.writeFileSync(path.join(root, genFlagName(c.rule.id)), c.flagFixture);
      fs.writeFileSync(path.join(root, genNoFlagName(c.rule.id)), c.noFlagFixture);
    }
    for (const d of otherPackFixtureDirs) {
      const name = path.basename(path.resolve(d));
      fs.cpSync(d, path.join(root, name), { recursive: true });
    }
    const { project, files } = buildProject(root);

    // The project holds the candidate's own fixtures plus every other pack's tree, so each
    // interpretRule call below is the "runs over all of test/fixtures/" check (4): a rule that
    // throws on the superset is caught per-candidate and rejected.
    const results: AdmissionResult[] = [];
    for (const c of cands) {
      const reasons: string[] = [];
      let ctx;
      try {
        ctx = interpretRule(c.rule, project, root);
      } catch (e) {
        results.push({ ruleId: c.rule.id, admitted: false, reasons: [`runs over all fixtures without throwing: interpreter threw (${String(e)})`] });
        continue;
      }
      const findings = ctx.findings;
      const inFile = (f: string) => findings.filter((x) => x.file === f || x.file.endsWith(`/${f}`));

      // (1) flags its FLAG fixture.
      const flagFile = genFlagName(c.rule.id);
      if (files.has(flagFile) && inFile(flagFile).length === 0) reasons.push(`never flags its own ${flagFile}`);

      // (2) silent on its no-flag fixture.
      const nfFile = genNoFlagName(c.rule.id);
      if (files.has(nfFile) && inFile(nfFile).length > 0)
        reasons.push(`flags ${nfFile} (${inFile(nfFile).length} findings) — the negative control failed`);

      // (3) silent on every other pack's fixtures.
      const other = findings.filter((f) => {
        const rel = f.file.split(path.sep).join("/");
        const segs = rel.split("/");
        const top = segs[0];
        // The candidate's own gen-* files are top-level; other packs live in a sub-dir named after
        // the fixture root (v6-app, zod3-app, express4-app, crlf-ci, ...).
        return top && !top.startsWith(GEN_FLAG_PREFIX) && !top.startsWith(GEN_NOFLAG_PREFIX) && segs.length > 1;
      });
      if (other.length > 0) reasons.push(`flags ${other.length} line(s) in another pack's fixtures: ${other.slice(0, 3).map((o) => `${o.file}:${o.line}`).join(", ")}`);

      results.push({ ruleId: c.rule.id, admitted: reasons.length === 0, reasons });
    }
    return results;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** The candidate's gen-* fixture files, as a map of ruleId -> {flag, noFlag}. */
export function candidateFixtureFiles(cands: Candidate[]): Map<string, { flag: string; noFlag: string }> {
  const out = new Map<string, { flag: string; noFlag: string }>();
  for (const c of cands) out.set(c.rule.id, { flag: genFlagName(c.rule.id), noFlag: genNoFlagName(c.rule.id) });
  return out;
}

export { genFlagName, genNoFlagName };
