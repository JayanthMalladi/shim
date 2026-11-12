// The default import of "zod" binds the same `z` object. Every rule applies to it.
import z from "zod";

export const m1 = z.string().default("a").optional(); // FLAG R1
export const m2 = z.string().uuid(); // FLAG R3
export const m3 = z.string().email(); // OK R3 (.email is not .uuid)
