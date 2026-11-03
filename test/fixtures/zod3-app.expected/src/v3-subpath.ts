// Code that imports "zod/v3": after the bump it keeps v3 semantics,
// so NO rule flags it. One line of each R1-R8 pattern, all OK.
import { z } from "zod/v3";

export const k1 = z.string().default("a").optional(); // OK R1
export const k2 = z.string().transform((s) => s.trim()).default("x"); // OK R2
export const k3 = z.string().uuid(); // OK R3
export const k4 = z.record(z.enum(["a", "b"]), z.number()); // OK R4
export const k5 = z.object({ u: z.unknown() }); // OK R5
export const k6 = z.object({ f: z.coerce.boolean() }); // OK R6
export const k7 = z.intersection(z.object({}), z.object({})); // OK R7
function k8(S, x) { // OK R8
  const r = S.safeParse(x);
  return r.error.errors;
}

export { k1, k2, k3, k4, k5, k6, k7, k8 };
