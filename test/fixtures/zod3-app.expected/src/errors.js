import { z, ZodError } from "zod";

function validate(raw) {
  const S = z.object({ name: z.string(), age: z.coerce.number() });
  // FLAG R8
  const r = S.safeParse(raw);
  // FLAG R8 (in a .js file ZodError.errors is undefined at runtime)
  if (!r.success) console.log(r.error.issues);
  return r;
}

function rethrow(e) {
  // FLAG R8 (narrowed by instanceof ZodError: .errors removed in Zod 4 -> .issues)
  if (e instanceof ZodError) return e.issues;
  throw e;
}

// --- R7 zod-intersection-error (this file references ZodError, so the calls match) ---
// FLAG R7
export const h1 = z.intersection(z.object({}), z.object({}));
// FLAG R7
export const h2 = z.string().and(z.number());

// OK R8 (.issues is the Zod 4 property, not .errors)
function okIssues(res) {
  return res.issues;
}

// OK R8 (fetch responses have .errors too, but the receiver isn't a safeParse result)
async function okFetch() {
  const res = await fetch("/x");
  return res.errors;
}

export { validate, rethrow, okIssues, okFetch };
