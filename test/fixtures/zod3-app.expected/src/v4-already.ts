// Code that already imports "zod/v4": after the bump it keeps v4 semantics,
// so NO rule flags it. One line of each R1-R8 pattern, all OK.
import { z } from "zod/v4";

export const j1 = z.string().default("a").optional(); // OK R1
export const j2 = z.string().transform((s) => s.trim()).default("x"); // OK R2
export const j3 = z.string().uuid(); // OK R3
export const j4 = z.record(z.enum(["a", "b"]), z.number()); // OK R4
export const j5 = z.object({ u: z.unknown() }); // OK R5
export const j6 = z.object({ f: z.coerce.boolean() }); // OK R6
export const j7 = z.intersection(z.object({}), z.object({})); // OK R7
function j8(S, x) { // OK R8
  const r = S.safeParse(x);
  return r.error.errors;
}

export { j1, j2, j3, j4, j5, j6, j7, j8 };
