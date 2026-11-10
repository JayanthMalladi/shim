// A file that imports only `{ ZodError }` from "zod" (no `z`). Such a file used
// to be skipped entirely, so its narrowed `.errors` reads were missed. R8's
// narrowed-binding branch must still run here; R1-R7/R9 have nothing to find
// (there is no `z` chain in the file), and R8's safeParse branch must stay off
// because it depends on a `z` binding being present.
import { ZodError } from "zod";

function narrow(e) {
  if (e instanceof ZodError) return e.issues; // FLAG R8 (narrowed by instanceof ZodError: .errors -> .issues)
  throw e;
}

const bag = { errors: [] };
function unrelated() {
  return bag.errors; // OK R8 (bag is not a ZodError-narrowed binding: leave it)
}

export { narrow, unrelated };
