/**
 * S06c: unit tests for the deterministic evidence-citation gate (`evidenceCited` /
 * `citedCandidates`). The gate rejects, before the judge runs, any candidate whose `evidence`
 * the draft model wrote is not (after whitespace normalization) a .d.ts diff line it was shown or a
 * substring of the changelog. A fabricated or paraphrased citation must drop the candidate.
 */
import { describe, expect, it } from "vitest";
import { evidenceCited, citedCandidates } from "../src/pack-builder/model.js";
import type { Candidate, DslRule, Evidence } from "../src/pack-builder/types.js";

/** A minimal Evidence: one removed export + a changelog with two bullet lines. */
const evidence: Evidence = {
  package: "zod",
  from: "3.25.76",
  to: "4.6.7",
  fromSurface: { version: "3.25.76", files: [], exports: [] },
  toSurface: { version: "4.6.7", files: [], exports: [] },
  diff: {
    removed: [{ name: "ZodError", signature: "ZodError { errors | name }", file: "index.d.ts" }],
    changed: [{ name: "z", fromSig: "z { string | object }", toSig: "z { string | object | prefault }", file: "index.d.ts" }],
    added: [{ name: "prefault", signature: "prefault<T>(): PrefaultZod", file: "index.d.ts" }],
  },
  changelog: "## Breaking changes\n- ZodError.errors renamed to ZodError.issues\n- z.string().uuid() is stricter in v4; use z.guid() for the old pattern\n",
};

const rule = (id: string): DslRule => ({
  id,
  package: "zod",
  import: { specifier: "zod", bindings: ["z"] },
  detect: { kind: "propAccess", prop: "errors", receiverShape: "safeParseError" },
  emit: { severity: "silent", fix: "auto", message: "ZodError.errors -> .issues" },
});

const cand = (id: string, evidenceLine: string): Candidate => ({
  rule: rule(id),
  flagFixture: "const e = err.errors; // FLAG",
  noFlagFixture: "const i = err.issues; // OK",
  evidence: evidenceLine,
});

describe("S06c evidence-citation gate", () => {
  it("admits a candidate that cites an exact .d.ts diff line", () => {
    // evidenceLines renders the removed row as `removed ZodError  (was: ...)  [index.d.ts]`.
    const c = cand("r1", "removed ZodError  (was: ZodError { errors | name })  [index.d.ts]");
    expect(evidenceCited(evidence, c)).toBe(true);
  });

  it("admits a candidate that cites a changelog substring", () => {
    const c = cand("r2", "ZodError.errors renamed to ZodError.issues");
    expect(evidenceCited(evidence, c)).toBe(true);
  });

  it("matches a diff line after whitespace normalization (extra spaces)", () => {
    const c = cand("r3", "removed ZodError (was: ZodError { errors | name }) [index.d.ts]"); // single spaces
    expect(evidenceCited(evidence, c)).toBe(true);
  });

  it("matches a changelog line after whitespace normalization (run of spaces)", () => {
    const c = cand("r4", "z.string().uuid() is  stricter  in v4; use z.guid() for the old pattern"); // doubled spaces
    expect(evidenceCited(evidence, c)).toBe(true);
  });

  it("rejects a fabricated citation that is neither a diff line nor changelog text", () => {
    const c = cand("r5", "the changelog says uuid is now banned in all contexts");
    expect(evidenceCited(evidence, c)).toBe(false);
  });

  it("rejects a paraphrase of a diff line (the gate wants a verbatim citation)", () => {
    const c = cand("r6", "the ZodError export was removed in v4");
    expect(evidenceCited(evidence, c)).toBe(false);
  });

  it("rejects an empty citation", () => {
    expect(evidenceCited(evidence, cand("r7", "  "))).toBe(false);
  });

  it("rejects when there is no changelog and the citation is not a diff line", () => {
    const noLog: Evidence = { ...evidence, changelog: undefined };
    expect(evidenceCited(noLog, cand("r8", "ZodError.errors renamed to ZodError.issues"))).toBe(false);
    // but the diff-line citation still passes without a changelog
    expect(evidenceCited(noLog, cand("r9", "added prefault  [index.d.ts]"))).toBe(true);
  });

  it("filters a mixed candidate set down to the cited ones", () => {
    const cands: Candidate[] = [
      cand("good-diff", "removed ZodError  (was: ZodError { errors | name })  [index.d.ts]"),
      cand("good-log", "z.string().uuid() is stricter in v4; use z.guid() for the old pattern"),
      cand("bad", "this rule is definitely fine, I promise"),
    ];
    const kept = citedCandidates(evidence, cands).map((c) => c.rule.id);
    expect(kept).toEqual(["good-diff", "good-log"]);
  });
});
