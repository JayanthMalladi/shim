/**
 * S06f: tests for the inline-fixture path in toCandidates (build.ts).
 * Inline flagFixture / noFlagFixture strings in answers.json are preferred;
 * __fixtures__/ files (named by genFlagName / genNoFlagName) are the fallback.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { toCandidates } from "../src/pack-builder/build.js";
import type { DraftAnswer, DslRule } from "../src/pack-builder/types.js";

const rule: DslRule = {
  id: "test-rule",
  package: "zod",
  import: { specifier: "z", bindings: ["z"] },
  detect: { kind: "chain", method: "test", root: "string" },
  emit: { severity: "error", fix: "auto", message: "use .safeTest()" },
  evidence: "changed z.string().test() removed",
};

function makeInline(): DraftAnswer {
  return {
    evidence: rule.evidence,
    rule,
    flagFixture: "import { z } from 'zod';\nz.string().test('x'); // FLAG",
    noFlagFixture: "import { z } from 'zod';\nz.string().safeTest('x'); // OK",
  };
}

function makeSkipOnly(): DraftAnswer {
  return { evidence: "skip reason", rule, flagFixture: undefined, noFlagFixture: undefined };
}

describe("toCandidates — inline fixtures", () => {
  const tmpDir = () => fs.mkdtempSync(path.join(process.cwd(), "tmp-cands-"));

  it("produces a candidate when answers carry inline fixtures", () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, "__fixtures__"), { recursive: true });
    const cands = toCandidates([makeInline()], dir);
    expect(cands).toHaveLength(1);
    expect(cands[0].rule.id).toBe("test-rule");
    expect(cands[0].flagFixture).toContain("// FLAG");
    expect(cands[0].noFlagFixture).toContain("// OK");
    fs.rmSync(dir, { recursive: true });
  });

  it("produces no candidate when answers lack inline fixtures and __fixtures__/ files are absent", () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, "__fixtures__"), { recursive: true });
    // write other files so the dir isn't empty — toCandidates should still reject this one
    const cands = toCandidates([makeSkipOnly()], dir);
    expect(cands).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });

  it("falls back to __fixtures__/ files when inline fixtures are absent", () => {
    const dir = tmpDir();
    const fxDir = path.join(dir, "__fixtures__");
    fs.mkdirSync(fxDir, { recursive: true });
    fs.writeFileSync(path.join(fxDir, `gen-flag-${rule.id}.ts`), "flag code // FLAG");
    fs.writeFileSync(path.join(fxDir, `gen-noflag-${rule.id}.ts`), "noflag code // OK");
    const answer: DraftAnswer = { evidence: rule.evidence, rule };
    const cands = toCandidates([answer], dir);
    expect(cands).toHaveLength(1);
    expect(cands[0].flagFixture).toBe("flag code // FLAG");
    expect(cands[0].noFlagFixture).toBe("noflag code // OK");
    fs.rmSync(dir, { recursive: true });
  });

  it("skips answers with no rule", () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, "__fixtures__"), { recursive: true });
    const cands = toCandidates([{ evidence: "x" }] as any, dir);
    expect(cands).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });
});
