import { z } from "zod";

// --- R1 zod-default-then-optional: .optional()/.nullish() right after .default() ---
export const a1 = z.string().default("a").optional(); // FLAG R1
export const a2 = z.number().default(() => 1).nullish(); // FLAG R1
export const a3 = z.object({ p: z.boolean().default(true).optional() }); // FLAG R1 (inside a z.object property)
export const a4 = z.string().optional().default("a"); // OK R1 (.optional() before .default())
const foo = { default: (v: unknown) => v, optional: (v: unknown) => v }; // OK R1 (a local, non-zod object with .default/.optional methods)
export const a5 = foo.default(1).optional();

// --- R2 zod-default-through-transform: .default() after transform/pipe/trim/... ---
export const b1 = z.string().transform((s) => s.trim()).default("x"); // FLAG R2
export const b2 = z.string().trim().default(" x"); // FLAG R2
export const b3 = z.string().toLowerCase().default("X"); // FLAG R2
export const b4 = z.string().pipe(z.string()).default("x"); // FLAG R2
export const b5 = z.string().default("x"); // OK R2 (a plain .default on a string chain, no transform before it)
export const b6 = z.string().min(1).default("x"); // OK R2 (.min is not a behavior-changing method)
export const b7 = z.string().optional().default("x"); // OK R2

// --- R3 zod-uuid-strict: .uuid() on a z.string() chain ---
export const c1 = z.string().uuid(); // FLAG R3
export const c2 = z.string().uuid({ message: "bad" }); // FLAG R3
export const c3 = z.string().min(1).uuid(); // FLAG R3
export const c4 = z.string().email(); // OK R3 (.email is not .uuid)
import * as lib from "some-uuid-lib"; // OK R3 (a library's own uuid, not a zod chain)
export const c5 = lib.uuid();

// --- R4 zod-record-exhaustive: z.record keyed by enum/nativeEnum/literal-union ---
export const d1 = z.record(z.enum(["a", "b"]), z.number()); // FLAG R4
const Keys = z.enum(["x", "y"]);
export const d2 = z.record(Keys, z.number()); // FLAG R4 (Keys is a same-file const initialized to a zod enum chain)
export const d3 = z.record(z.union([z.literal("a"), z.literal("b")]), z.string()); // FLAG R4
export const d4 = z.record(z.nativeEnum(E), z.string()); // FLAG R4-nativeEnum
export const d5 = z.record(z.string(), z.number()); // OK R4 (string-keyed record: keys are not exhaustive)
export const d6 = z.record(z.number()); // OK R4 (single-argument record; tsc catches it, not this rule)

// --- R5 zod-unknown-key-required: z.unknown()/z.any() object property, no .optional() ---
export const e1 = z.object({ u: z.unknown() }); // FLAG R5
export const e2 = z.object({ a: z.any() }); // FLAG R5
export const e3 = z.object({ u: z.unknown().optional() }); // OK R5 (.optional() already present)
export const e4 = z.array(z.unknown()); // OK R5 (z.array of unknown: not an object property)
export const e5 = z.unknown(); // OK R5 (z.unknown() not inside an object)

// --- R6 zod-coerce-missing-key: z.coerce.<x>() property in z.object, unguarded ---
export const f1 = z.object({ f: z.coerce.boolean() }); // FLAG R6
export const f2 = z.object({ n: z.coerce.number() }); // FLAG R6
export const f3 = z.object({ f: z.coerce.boolean().optional() }); // OK R6 (.optional() present)
export const f4 = z.object({ f: z.coerce.boolean().default(false) }); // OK R6 (.default present)

// --- R7 zod-intersection-error: z.intersection/.and in a file that checks ZodError ---
export const g1 = z.intersection(z.object({}), z.object({})); // FLAG R7 (this file references ZodError further down)
export const g2 = z.string().and(z.number()); // FLAG R7
// (The OK R7 case, "intersection in a file with no ZodError reference", lives in
//  v4-already.ts and aliased.ts, which import zod but never mention ZodError.)

// R8 zod-errors-property: .error.errors / ZodError.errors — see src/errors.js.

declare const E: Record<string, unknown>;
