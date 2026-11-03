// Aliased and namespace imports of zod: the scanner must follow `zz` (alias of z)
// and `Z` (namespace) to their chains, but NOT a library's own `lib.uuid`.
import { z as zz } from "zod";
import * as Z from "zod";
import * as lib from "some-uuid-lib";

export const i1 = zz.string().guid(); // FLAG R3 (zz is an alias of z)
export const i2 = Z.string().guid(); // FLAG R3 (Z is a namespace import of zod)
export const i3 = lib.uuid(); // OK R3 (lib is not zod)

export const i4 = zz.object({ u: zz.unknown().optional() }); // FLAG R5 (a z.unknown() object property through the zz alias)
export const i5 = zz.object({ u: zz.unknown().optional() }); // OK R5 (already .optional())

// R7 OK case: a .and() on a zod chain in a file that never mentions ZodError.
export const i6 = Z.string().and(Z.number()); // OK R7

export { i1, i2, i3, i4, i5, i6 };
