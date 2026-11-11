// A file that imports `{ ZodError }` from "zod/v3": it keeps v3 semantics, so
// nothing flags it. The scanner must not treat a "zod/v3" ZodError import as a
// zod-4 narrowing source.
import { ZodError } from "zod/v3";

function narrow(e) {
  if (e instanceof ZodError) return e.errors; // OK R8 (zod/v3 keeps v3 semantics: no rule flags it)
  throw e;
}

export { narrow };
