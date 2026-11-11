// A key schema imported from a sibling file: the scanner is static-only and does
// not follow cross-file imports, so `z.record(uuidId, ...)` cannot be proven
// exhaustive and must not be flagged R4. The record call previously made isZodChain
// recurse on `uuidId` forever (no initializer) and crash; it must now just return
// false. The two-const cycle below is the same crash through constInitializerMap.
import { z } from "zod";
import { uuidId } from "./uuid-key.js";

export const ids = z.record(uuidId, z.string()); // OK R4 (imported identifier: not provable, must not flag)

// Two same-file consts that point at each other: isZodChain(a) -> isZodChain(b)
// -> isZodChain(a) ... The scan must finish without a RangeError.
const a = b;
const b = a;
export const c = z.object({ x: a }); // OK R4 (the cycle produces no finding)
