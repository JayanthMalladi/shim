import { z, ZodError } from "zod";

function validate(raw) {
  const S = z.object({ name: z.string(), age: z.coerce.number() });
  const r = S.safeParse(raw); // FLAG R8
  if (!r.success) console.log(r.error.errors); // FLAG R8 (in a .js file ZodError.errors is undefined at runtime)
  return r;
}

function rethrow(e) {
  if (e instanceof ZodError) return e.errors; // FLAG R8 (narrowed by instanceof ZodError: .errors removed in Zod 4 -> .issues)
  throw e;
}

// --- R7 zod-intersection-error (this file references ZodError, so the calls match) ---
export const h1 = z.intersection(z.object({}), z.object({})); // FLAG R7
export const h2 = z.string().and(z.number()); // FLAG R7

function okIssues(res) {
  return res.issues; // OK R8 (.issues is the Zod 4 property, not .errors)
}

async function okFetch() {
  const res = await fetch("/x");
  return res.errors; // OK R8 (fetch responses have .errors too, but the receiver isn't a safeParse result)
}

export { validate, rethrow, okIssues, okFetch };
