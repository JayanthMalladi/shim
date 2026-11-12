import { z } from "zod";
const S = z.coerce.number();
export function parse(v: unknown) {
  const r = S.safeParse(v);
  if (!r.success) return r.error.errors.map((e) => e.path);
  return r.data;
}
