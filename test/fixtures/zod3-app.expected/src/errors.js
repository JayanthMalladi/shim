import { z, ZodError } from "zod";
import { ZodError as ZE } from "zod";

function validate(raw) {
  const S = z.object({ name: z.string(), age: z.coerce.number() }); // FLAG R6 (unguarded coerce field)
  const r = S.safeParse(raw);
  if (!r.success) console.log(r.error.issues); // FLAG R8 (in a .js file ZodError.errors is undefined at runtime)
  return r;
}

function rethrow(e) {
  if (e instanceof ZodError) return e.issues; // FLAG R8 (narrowed by instanceof ZodError: .errors removed in Zod 4 -> .issues)
  throw e;
}

function rethrowNamespaced(e) {
  if (e instanceof z.ZodError) return e.issues; // FLAG R8 (narrowed by instanceof z.ZodError, a zod-namespace access)
  throw e;
}

function rethrowAliased(e) {
  if (e instanceof ZE) return e.issues; // FLAG R8 (narrowed by an aliased ZodError named import)
  throw e;
}

const other = { ZodError: class {} };
function notZod(x) {
  if (x instanceof other.ZodError) return x.errors; // OK R8 (other is not a zod binding: not a ZodError narrowing)
  throw x;
}

// --- R7 zod-intersection-error: this file imports ZodError and instanceof-checks it,
// so its intersections/.and are flagged. ---
export const h1 = z.intersection(z.object({}), z.object({})); // FLAG R7
export const h2 = z.string().and(z.number()); // FLAG R7

function okIssues(res) {
  return res.issues; // OK R8 (.issues is the Zod 4 property, not .errors)
}

async function okFetch() {
  const res = await fetch("/x");
  return res.errors; // OK R8 (fetch responses have .errors too, but the receiver isn't a safeParse result)
}

export { validate, rethrow, rethrowNamespaced, rethrowAliased, notZod, okIssues, okFetch };
