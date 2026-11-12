// A key schema exported from a sibling file. The scanner is static-only and does
// not follow cross-file imports, so a consumer using `uuidId` as a z.record key
// cannot be proven exhaustive. This file itself has no record call -> no findings.
import { z } from "zod";

export const uuidId = z.enum(["v1", "v4"]);
