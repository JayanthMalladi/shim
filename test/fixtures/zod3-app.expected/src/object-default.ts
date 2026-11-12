// R9: Zod 3 ran an object's .default() value through the object schema; Zod 4 returns it as is.
import { z } from "zod";

const Levels = z.object({ error: z.string().default("pass"), debug: z.string().default("drop") });

export const o1 = z.object({ levels: Levels.prefault({}) }); // FLAG R9 (same-file const object)
export const o2 = z.object({ a: z.string().default("x") }).prefault({}); // FLAG R9
export const o3 = z.strictObject({ a: z.string().default("x") }).prefault({}); // FLAG R9
export const o4 = z.object({ a: z.string() }).partial().prefault({}); // FLAG R9 (still an object)
export const o5 = z.object({ a: z.string() }).optional(); // FLAG R1 (R1 wins)
export const o6 = z.array(z.object({ a: z.string() })).default([]); // OK R9 (array root)
export const o7 = z.string().default("x"); // OK R9 (not an object)
