// T2: Zod behavior oracle.
//
// Each it() below asserts BOTH the Zod 3 result and the Zod 4 result exactly as in
// plan.md §T2 step 2, and where the row has a fix, a second assertion that the
// FIXED Zod 4 schema gives the Zod 3 result. These tests are the specification
// for T3's rules: T3's rewrites must make "fixed v4" behave like "v3".
//
// zod3 = zod@3.25.76 (the v3 library), zod4 = zod@4.6.7 (the v4 library).
// They are installed via the npm alias `zod3@npm:zod@3.25.76` and
// `zod4@npm:zod@4.6.7`. The npm alias mechanism gives real packages named
// "zod3" and "zod4" under node_modules, so the import specifiers are "zod3"
// and "zod4" (verified: the installed package.json in node_modules/zod3 and
// node_modules/zod4 are the real zod 3.25.76 and 4.6.7 respectively).
import { describe, expect, it } from "vitest";
import { z as z3 } from "zod3";
import { z as z4 } from "zod4";

describe("zod oracle: v3 vs v4 behavior (T2)", () => {
  // Row 1: z.object({a: z.string().default("tuna").optional()}).parse({})
  // v3 -> {} ; v4 -> {a:"tuna"}. Fix: drop .default(...) -> z.string().optional() -> {}.
  it("row 1: default-then-optional in object drops the default in v4", () => {
    expect(z3.object({ a: z3.string().default("tuna").optional() }).parse({})).toEqual({});
    expect(z4.object({ a: z4.string().default("tuna").optional() }).parse({})).toEqual({ a: "tuna" });
    expect(z4.object({ a: z4.string().optional() }).parse({})).toEqual({});
  });

  // Row 2: z.object({a: z.string().default("t").nullish()}).parse({})
  // v3 -> {} ; v4 -> {a:"t"}. Fix: z.string().nullish() -> {}.
  it("row 2: default-then-nullish in object drops the default in v4", () => {
    expect(z3.object({ a: z3.string().default("t").nullish() }).parse({})).toEqual({});
    expect(z4.object({ a: z4.string().default("t").nullish() }).parse({})).toEqual({ a: "t" });
    expect(z4.object({ a: z4.string().nullish() }).parse({})).toEqual({});
  });

  // Row 3 (must-not-flag): z.object({a: z.string().optional().default("tuna")}).parse({})
  // v3 -> {a:"tuna"} ; v4 -> {a:"tuna"}. No fix. Order optional().default() is fine.
  it("row 3: optional-then-default keeps the default in both (must-not-flag)", () => {
    expect(z3.object({ a: z3.string().optional().default("tuna") }).parse({})).toEqual({ a: "tuna" });
    expect(z4.object({ a: z4.string().optional().default("tuna") }).parse({})).toEqual({ a: "tuna" });
  });

  // Row 4: z.string().transform(s => s.toUpperCase()).default("abc").parse(undefined)
  // v3 -> "ABC" (transform runs on the default) ; v4 -> "abc" (transform sees the input, default bypassed).
  // Fix: .prefault("abc") -> "ABC".
  it("row 4: default through transform runs transform on the default in v3, not in v4", () => {
    expect(z3.string().transform((s: string) => s.toUpperCase()).default("abc").parse(undefined)).toBe("ABC");
    expect(z4.string().transform((s: string) => s.toUpperCase()).default("abc").parse(undefined)).toBe("abc");
    expect(z4.string().transform((s: string) => s.toUpperCase()).prefault("abc").parse(undefined)).toBe("ABC");
  });

  // Row 5: z.string().trim().default("  x ").parse(undefined)
  // v3 -> "x" (trim applied to the default) ; v4 -> "  x " (trim is a transform; default bypassed).
  // Fix: .prefault("  x ") -> "x".
  it("row 5: default through trim in v3 trims the default, v4 does not", () => {
    expect(z3.string().trim().default("  x ").parse(undefined)).toBe("x");
    expect(z4.string().trim().default("  x ").parse(undefined)).toBe("  x ");
    expect(z4.string().trim().prefault("  x ").parse(undefined)).toBe("x");
  });

  // Row 6 (must-not-flag): z.string().default("x").parse(undefined)
  // v3 -> "x" ; v4 -> "x". No transform, identical in both.
  it("row 6: plain default (no transform) is identical in both (must-not-flag)", () => {
    expect(z3.string().default("x").parse(undefined)).toBe("x");
    expect(z4.string().default("x").parse(undefined)).toBe("x");
  });

  // Row 7: z.string().uuid().safeParse("a1b2c3d4-e5f6-1234-c234-123456789abc").success
  // v3 -> true ; v4 -> false (v4 uuid enforces RFC 4122 variant; this string's 3rd-group nibble is "c").
  // Fix: z.string().guid() -> true.
  it("row 7: uuid rejects a non-RFC4122 string in v4 but not v3", () => {
    const s = "a1b2c3d4-e5f6-1234-c234-123456789abc";
    expect(z3.string().uuid().safeParse(s).success).toBe(true);
    expect(z4.string().uuid().safeParse(s).success).toBe(false);
    expect(z4.string().guid().safeParse(s).success).toBe(true);
  });

  // Row 8: z.string().uuid({message:"bad"}).safeParse("x").error.issues[0].message
  // v3 -> "bad" ; v4 -> "bad". Custom message preserved in both.
  it("row 8: custom uuid error message preserved in both", () => {
    expect(z3.string().uuid({ message: "bad" }).safeParse("x").error!.issues[0].message).toBe("bad");
    expect(z4.string().uuid({ message: "bad" }).safeParse("x").error!.issues[0].message).toBe("bad");
  });

  // Row 9: z.record(z.enum(["a","b"]), z.number()).safeParse({a:1}).success
  // v3 -> true (partial keys OK) ; v4 -> false (v4 record requires all enum keys).
  // Fix: z.partialRecord(z.enum(["a","b"]), z.number()) -> true.
  it("row 9: enum-keyed record accepts partial keys in v3, requires all in v4", () => {
    const obj = { a: 1 } as Record<string, number>;
    expect(z3.record(z3.enum(["a", "b"]), z3.number()).safeParse(obj).success).toBe(true);
    expect(z4.record(z4.enum(["a", "b"]), z4.number()).safeParse(obj).success).toBe(false);
    expect(z4.partialRecord(z4.enum(["a", "b"]), z4.number()).safeParse(obj).success).toBe(true);
  });

  // Row 10: z.record(z.union([z.literal("a"), z.literal("b")]), z.number()).safeParse({a:1}).success
  // v3 -> true ; v4 -> false. Fix: z.partialRecord(...) -> true.
  it("row 10: union-of-literal-keyed record accepts partial keys in v3, requires all in v4", () => {
    const obj = { a: 1 } as Record<string, number>;
    const v3s = z3.record(z3.union([z3.literal("a"), z3.literal("b")]), z3.number());
    const v4s = z4.record(z4.union([z4.literal("a"), z4.literal("b")]), z4.number());
    const v4f = z4.partialRecord(z4.union([z4.literal("a"), z4.literal("b")]), z4.number());
    expect(v3s.safeParse(obj).success).toBe(true);
    expect(v4s.safeParse(obj).success).toBe(false);
    expect(v4f.safeParse(obj).success).toBe(true);
  });

  // Row 11 (verify): z.record(z.nativeEnum({A:"a",B:"b"}), z.number()).safeParse({a:1}).success
  // v3 -> true ; v4 -> false. Plan says fix z.partialRecord(...) -> true but the plan marks this
  // "verify". We assert the fix works here; if it fails, T3's R4 must drop nativeEnum.
  it("row 11: nativeEnum-keyed record accepts partial keys in v3, requires all in v4 (verify fix)", () => {
    const E = { A: "a", B: "b" } as const;
    const obj = { a: 1 } as Record<string, number>;
    const v3s = z3.record(z3.nativeEnum(E), z3.number());
    const v4s = z4.record(z4.nativeEnum(E as unknown as Record<string, string>), z4.number());
    const v4f = z4.partialRecord(z4.nativeEnum(E as unknown as Record<string, string>), z4.number());
    expect(v3s.safeParse(obj).success).toBe(true);
    expect(v4s.safeParse(obj).success).toBe(false);
    expect(v4f.safeParse(obj).success).toBe(true);
  });

  // Row 12 (must-not-flag): z.record(z.string(), z.number()).safeParse({a:1}).success
  // v3 -> true ; v4 -> true. String-keyed records still allow partial keys in both.
  it("row 12: string-keyed record accepts partial keys in both (must-not-flag)", () => {
    const obj = { a: 1 } as Record<string, number>;
    expect(z3.record(z3.string(), z3.number()).safeParse(obj).success).toBe(true);
    expect(z4.record(z4.string(), z4.number()).safeParse(obj).success).toBe(true);
  });

  // Row 13: z.object({u: z.unknown()}).safeParse({}).success
  // v3 -> true (unknown key missing is OK) ; v4 -> false (v4.4+ requires the key for z.unknown()).
  // Fix: z.unknown().optional() -> true.
  it("row 13: missing key for z.unknown() accepted in v3, rejected in v4", () => {
    expect(z3.object({ u: z3.unknown() }).safeParse({}).success).toBe(true);
    expect(z4.object({ u: z4.unknown() }).safeParse({}).success).toBe(false);
    expect(z4.object({ u: z4.unknown().optional() }).safeParse({}).success).toBe(true);
  });

  // Row 14: z.object({u: z.any()}).safeParse({}).success
  // v3 -> true ; v4 -> false. Fix: z.any().optional() -> true.
  it("row 14: missing key for z.any() accepted in v3, rejected in v4", () => {
    expect(z3.object({ u: z3.any() }).safeParse({}).success).toBe(true);
    expect(z4.object({ u: z4.any() }).safeParse({}).success).toBe(false);
    expect(z4.object({ u: z4.any().optional() }).safeParse({}).success).toBe(true);
  });

  // Row 15: z.object({f: z.coerce.boolean()}).safeParse({}).success
  // v3 -> true, data {f:false} (coerce undefined -> false) ; v4 -> false. No auto fix (manual).
  it("row 15: missing key for z.coerce.boolean() coerces in v3, fails in v4 (manual, no fix)", () => {
    const r3 = z3.object({ f: z3.coerce.boolean() }).safeParse({});
    expect(r3.success).toBe(true);
    if (r3.success) expect(r3.data).toEqual({ f: false });
    expect(z4.object({ f: z4.coerce.boolean() }).safeParse({}).success).toBe(false);
  });

  // Row 16: z.object({f: z.coerce.string()}).safeParse({}).success
  // v3 -> true, data {f:"undefined"} (coerce undefined -> "undefined") ; v4 -> false. Manual.
  it("row 16: missing key for z.coerce.string() coerces in v3, fails in v4 (manual, no fix)", () => {
    const r3 = z3.object({ f: z3.coerce.string() }).safeParse({});
    expect(r3.success).toBe(true);
    if (r3.success) expect(r3.data).toEqual({ f: "undefined" });
    expect(z4.object({ f: z4.coerce.string() }).safeParse({}).success).toBe(false);
  });

  // Row 17: z.intersection(A, B).parse(...) where B is an object transformed to a different shape
  // v3 -> throws ZodError ; v4 -> throws plain Error (not instanceof ZodError). Manual.
  it("row 17: conflicting intersection throws ZodError in v3, plain Error in v4 (manual)", () => {
    const A3 = z3.object({ a: z3.string() });
    const B3 = z3.object({ a: z3.string() }).transform(() => ({ a: "x" }));
    let threw3 = false;
    try {
      z3.intersection(A3, B3).parse({ a: "y" });
    } catch (e) {
      threw3 = true;
      expect(e).toBeInstanceOf(z3.ZodError);
    }
    expect(threw3).toBe(true);

    const A4 = z4.object({ a: z4.string() });
    const B4 = z4.object({ a: z4.string() }).transform(() => ({ a: "x" }));
    let threw4 = false;
    let err4: unknown;
    try {
      z4.intersection(A4, B4).parse({ a: "y" });
    } catch (e) {
      threw4 = true;
      err4 = e;
      expect(e).not.toBeInstanceOf(z4.ZodError);
    }
    expect(threw4).toBe(true);
    expect(err4).toBeInstanceOf(Error);
  });

  // Row 18: Array.isArray(z.string().safeParse(1).error.errors)
  // v3 -> true (ZodError.errors is the array) ; v4 -> false (ZodError.errors removed; .issues is the array).
  // Fix: read .issues -> true.
  it("row 18: ZodError.errors removed in v4; .issues holds the array", () => {
    const r3 = z3.string().safeParse(1);
    expect(r3.success).toBe(false);
    if (!r3.success) expect(Array.isArray(r3.error.errors)).toBe(true);

    const r4 = z4.string().safeParse(1);
    expect(r4.success).toBe(false);
    if (!r4.success) {
      const legacyErrors: unknown = (r4.error as unknown as { errors?: unknown }).errors;
      expect(Array.isArray(legacyErrors)).toBe(false);
      expect(Array.isArray(r4.error.issues)).toBe(true);
    }
  });

  // Row 19 (must-not-flag): z.string().email().safeParse("a@b").success
  // v3 -> false ; v4 -> false. No change.
  it("row 19: email validation identical in both (must-not-flag)", () => {
    expect(z3.string().email().safeParse("a@b").success).toBe(false);
    expect(z4.string().email().safeParse("a@b").success).toBe(false);
  });

  // Row 20: z.object({levels: S.default({})}).parse({}), where S's fields have their own defaults.
  // v3 -> {levels:{error:"pass",debug:"drop"}} (the default ran through S) ; v4 -> {levels:{}} (returned as is).
  // Fix: .prefault({}) -> the v3 result.
  it("row 20: object .default() is no longer parsed in v4; .prefault() keeps v3 behavior", () => {
    const S3 = z3.object({ error: z3.enum(["pass", "drop"]).default("pass"), debug: z3.enum(["pass", "drop"]).default("drop") });
    const S4 = z4.object({ error: z4.enum(["pass", "drop"]).default("pass"), debug: z4.enum(["pass", "drop"]).default("drop") });
    const v3Result = { levels: { error: "pass", debug: "drop" } };
    expect(z3.object({ levels: S3.default({}) }).parse({})).toEqual(v3Result);
    // @ts-expect-error -- v4 types .default()'s value as the output, so {} is a type error; it still runs.
    expect(z4.object({ levels: S4.default({}) }).parse({})).toEqual({ levels: {} });
    expect(z4.object({ levels: S4.prefault({}) }).parse({})).toEqual(v3Result);
  });
});
