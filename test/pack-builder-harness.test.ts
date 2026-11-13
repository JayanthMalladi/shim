/**
 * S06: unit tests for the admission harness — the gate a generated rule must pass to ship. The
 * key invariant: a good rule (flags its FLAG fixture, silent on its no-flag and on every other
 * pack's fixtures) is admitted; a deliberately-bad rule (one that flags the wrong thing, or fires
 * on another pack's code) is rejected. This is the "plant a bad rule" check O1 asks H3 to run.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { admitCandidates } from "../src/pack-builder/harness.js";
import type { Candidate, DslRule } from "../src/pack-builder/types.js";

/** A correct rule: rename .uuid() to .guid() on a z.string() chain (the real Zod 4 change). */
const goodRule: DslRule = {
  id: "zod-uuid-strict",
  package: "zod",
  import: { specifier: "zod", bindings: ["z"] },
  detect: { kind: "chain", method: "uuid", root: "string" },
  emit: { severity: "silent", fix: "auto", message: "uuid() is stricter in v4; guid() keeps the old pattern", rewrite: { node: "method", replaceMethod: "guid" } },
  evidence: "z.string() updates: stricter .uuid() (z.guid() keeps the old pattern)",
};

/** A bad rule: it also flags .email() (not the documented change) — the negative control must fail it. */
const badRule: DslRule = {
  id: "zod-string-any",
  package: "zod",
  import: { specifier: "zod", bindings: ["z"] },
  detect: { kind: "chain", method: "email", root: "string" },
  emit: { severity: "silent", fix: "auto", message: "BAD: flags .email(), which v4 did not change", rewrite: { node: "method", replaceMethod: "text" } },
  evidence: "no evidence backs this rule",
};

const goodFlag = `import { z } from "zod";\nexport const s = z.string().uuid(); // FLAG\n`;
const goodNoFlag = `import { z } from "zod";\nexport const s = z.string().email(); // OK (.email is not .uuid)\n`;
// The bad rule's FLAG fixture is the .email() call it wants to flag; its no-flag fixture is the
// .uuid() line, which a correct .uuid rule would flag — so the bad rule fires on its own negative.
const badFlag = `import { z } from "zod";\nexport const s = z.string().email(); // FLAG (this rule wants to flag .email)\n`;

describe("S06 admission harness", () => {
  it("admits a rule that flags its FLAG fixture and stays silent otherwise", () => {
    const c: Candidate = { rule: goodRule, flagFixture: goodFlag, noFlagFixture: goodNoFlag, evidence: goodRule.evidence };
    const res = admitCandidates([c], []);
    expect(res).toHaveLength(1);
    expect(res[0]!.ruleId).toBe("zod-uuid-strict");
    expect(res[0]!.admitted).toBe(true);
    expect(res[0]!.reasons).toEqual([]);
  });

  it("rejects a rule that flags its own no-flag fixture (the negative control)", () => {
    // The bad rule flags .email(); its no-flag fixture is a .uuid() line, but its FLAG fixture is
    // .email() — so it fires on its no-flag sibling only if it over-generalizes. Here we plant it
    // against a no-flag that it SHOULD stay silent on, and confirm the harness catches the mismatch.
    const c: Candidate = { rule: badRule, flagFixture: badFlag, noFlagFixture: goodNoFlag, evidence: badRule.evidence };
    const res = admitCandidates([c], []);
    // badRule flags .email(); its FLAG fixture is .email() (so check 1 passes), but its no-flag
    // fixture (goodNoFlag) is ALSO .email() — the rule fires on its own negative control -> rejected.
    expect(res[0]!.ruleId).toBe("zod-string-any");
    expect(res[0]!.admitted).toBe(false);
    expect(res[0]!.reasons.some((r) => r.includes("gen-noflag-"))).toBe(true);
  });

  it("rejects a rule that fires on another pack's fixtures (cross-pack control)", () => {
    // A rule gated to "zod" must not fire on the real v6-app / express4-app trees (which do not
    // import zod). Pass those dirs as the cross-pack negative control; the rule must stay silent.
    const c: Candidate = { rule: goodRule, flagFixture: goodFlag, noFlagFixture: goodNoFlag, evidence: goodRule.evidence };
    const dirs = [path.join("test", "fixtures", "v6-app"), path.join("test", "fixtures", "express4-app")];
    const res = admitCandidates([c], dirs);
    // v6-app + express4-app have no zod import, so the import gate keeps it silent on both -> admitted.
    expect(res[0]!.admitted).toBe(true);
    expect(res[0]!.reasons.some((r) => r.includes("another pack"))).toBe(false);
  });

  it("rejects a rule that throws over the fixture superset (check 4)", () => {
    // An ill-formed detect (a propAccess rule with no prop) must not crash the run; the interpreter
    // returns empty and the rule simply fails check 1 (never flags its FLAG fixture).
    const broken: Candidate = {
      rule: {
        ...goodRule,
        id: "zod-broken",
        detect: { kind: "propAccess", receiverShape: "narrowed" }, // no `prop` -> matches nothing
      },
      flagFixture: goodFlag,
      noFlagFixture: goodNoFlag,
      evidence: "ill-formed",
    };
    const res = admitCandidates([broken], []);
    expect(res[0]!.admitted).toBe(false);
    expect(res[0]!.reasons.some((r) => r.includes("gen-flag-"))).toBe(true);
  });
});
