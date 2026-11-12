import type { PackManifest } from "../../types.js";

/**
 * S05: the declarative record of "this Zod 3 -> 4 change breaks this code". One entry per rule
 * R1-R9 in src/rules/zod-v4.ts. The pack's scanner is gated to files that import exactly "zod",
 * so the pack-level must-NOT-flag files are the "zod/v3" and "zod/v4" subpath imports, which the
 * scanner leaves alone (error-only-v3.js / v3-subpath.ts / v4-already.ts). Descriptive only: the
 * scanner keeps producing byte-identical findings. `source` is the official Zod 4 changelog
 * heading each rule encodes (https://zod.dev/v4/changelog).
 */
export const zodV4: PackManifest = {
  id: "zod-v4",
  package: "zod",
  from: "^3.0.0",
  to: "^4.0.0",
  rules: [
    {
      id: "zod-default-then-optional",
      severity: "silent",
      fix: "auto",
      change: "Zod 4 applies `.default()` inside `.optional()`/`.nullish()` when the key is missing; Zod 3 left it undefined.",
      source: "https://zod.dev/v4/changelog — z.object(): defaults applied within optional fields",
      fixtures: [
        "test/fixtures/zod3-app/src/schemas.ts",
        "test/fixtures/zod3-app/src/default-import.ts",
        "test/fixtures/zod3-app/src/object-default.ts",
      ],
    },
    {
      id: "zod-default-through-transform",
      severity: "silent",
      fix: "auto",
      change: "Zod 4's `.default()` returns the value without running it through the schema; `.prefault()` keeps the Zod 3 parse.",
      source: "https://zod.dev/v4/changelog — .default() updates (ZodDefault short-circuits; new .prefault())",
      fixtures: ["test/fixtures/zod3-app/src/schemas.ts"],
    },
    {
      id: "zod-uuid-strict",
      severity: "silent",
      fix: "auto",
      change: "Zod 4's `uuid()` rejects UUIDs without the RFC 9562 variant bits; `guid()` keeps the Zod 3 pattern.",
      source: "https://zod.dev/v4/changelog — z.string() updates: stricter .uuid() (z.guid() keeps the old pattern)",
      fixtures: [
        "test/fixtures/zod3-app/src/schemas.ts",
        "test/fixtures/zod3-app/src/aliased.ts",
        "test/fixtures/zod3-app/src/default-import.ts",
      ],
    },
    {
      id: "zod-record-exhaustive",
      severity: "silent",
      fix: "auto",
      change: "Zod 4 requires every key of an enum/literal-keyed `z.record()`; `z.partialRecord()` keeps the optional-key behavior.",
      source: "https://zod.dev/v4/changelog — z.record(): improves enum support (z.partialRecord() keeps v3 behavior)",
      fixtures: [
        "test/fixtures/zod3-app/src/schemas.ts",
        "test/fixtures/zod3-app/src/imported-key.ts",
      ],
    },
    {
      id: "zod-unknown-key-required",
      severity: "silent",
      fix: "auto",
      change: "Since Zod 4.4 a missing key on a `z.unknown()`/`z.any()` object field fails; `.optional()` keeps the accept behavior.",
      source: "https://zod.dev/v4/changelog — z.object(): changes z.unknown() optionality (required at parse time as of v4.4)",
      fixtures: [
        "test/fixtures/zod3-app/src/schemas.ts",
        "test/fixtures/zod3-app/src/aliased.ts",
      ],
    },
    {
      id: "zod-coerce-missing-key",
      severity: "silent",
      fix: "manual",
      change: "In Zod 4 a missing key for a `z.coerce.*` field fails; Zod 3 coerced undefined. No safe deterministic rewrite.",
      source: "https://zod.dev/v4/changelog — z.coerce updates (a missing key on a z.coerce field now errors)",
      fixtures: [
        "test/fixtures/zod3-app/src/schemas.ts",
        "test/fixtures/zod3-app/src/errors.js",
      ],
    },
    {
      id: "zod-intersection-error",
      severity: "silent",
      fix: "manual",
      change: "In Zod 4 a conflicting `z.intersection`/`.and` throws a plain Error, not a ZodError, so `instanceof ZodError` checks miss it.",
      source: "https://zod.dev/v4/changelog — z.intersection(): throws Error on merge conflict",
      fixtures: [
        "test/fixtures/zod3-app/src/errors.js",
        "test/fixtures/zod3-app/src/schemas.ts",
      ],
    },
    {
      id: "zod-errors-property",
      severity: "break",
      fix: "auto",
      change: "`ZodError.errors` was removed in Zod 4; `.issues` holds the same array.",
      source: "https://zod.dev/v4/changelog — ZodError: drops .errors (use .issues)",
      fixtures: [
        "test/fixtures/zod3-app/src/errors.js",
        "test/fixtures/zod3-app/src/error-only.js",
        "test/fixtures/zod3-app/src/error-only-v3.js",
        "test/fixtures/zod3-app/src/v3-subpath.ts",
        "test/fixtures/zod3-app/src/v4-already.ts",
      ],
    },
    {
      id: "zod-object-default",
      severity: "silent",
      fix: "auto",
      change: "Zod 4's `.default()` on an object returns the value as is (no inner field defaults); `.prefault()` keeps the Zod 3 parse.",
      source: "https://zod.dev/v4/changelog — .default() updates (on an object schema the default is not parsed)",
      fixtures: ["test/fixtures/zod3-app/src/object-default.ts"],
    },
  ],
};
