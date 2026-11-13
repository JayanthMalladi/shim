/** How a change surfaces if nobody fixes it. */
export type Severity =
  /** Fails at install, build, or the first call. Type checks or tests usually catch it. */
  | "break"
  /** Still compiles and runs, but does something different. Nothing catches it. */
  | "silent"
  /** Works today, removed in the next major. */
  | "deprecated";

/** Who applies the fix. */
export type FixKind =
  /** Deterministic rewrite applied by Shim, behavior-preserving. */
  | "auto"
  /** Needs judgment; handed to the fixer agent with the finding as its brief. */
  | "agent"
  /** Reported in the PR body for a human; never edited automatically. */
  | "manual";

export interface Finding {
  ruleId: string;
  severity: Severity;
  fix: FixKind;
  file: string;
  line: number;
  snippet: string;
  message: string;
}

export interface ScanResult {
  root: string;
  filesScanned: number;
  findings: Finding[];
}

/**
 * S05: the declarative record of "this API change breaks this code" that one pack
 * (one migration) carries. One manifest per `MIGRATIONS` entry; the registry is
 * `src/packs.ts`. Descriptive only — the scanners keep producing byte-identical
 * findings — but `exposure.ts` and `migrations.ts` now read `package` and the major
 * `to` from the manifest instead of their own mirrors, and `test/packs.test.ts`
 * proves the `rules` entries agree with what each scanner actually emits.
 */
export interface PackManifest {
  /** The `MIGRATIONS` entry id this manifest describes: "ai-sdk-v7" | "zod-v4" | "express-v5". */
  id: string;
  /** The package name the pack's scanners look for ("ai", "zod", "express"). */
  package: string;
  /** The semver range of the OLD major the migration upgrades away from. */
  from: string;
  /** The semver range of the NEW major the bump rewrites to. */
  to: string;
  /** One entry per ruleId this pack's scan path can emit. */
  rules: Array<{
    /** The existing ruleId, unchanged — it points at the rule that emits it. */
    id: string;
    severity: Severity;
    fix: FixKind;
    /** One sentence: what changed in the library that this rule detects. */
    change: string;
    /** The exact changelog / migration-guide URL plus the heading the rule encodes. */
    source: string;
    /**
     * Fixture cases that already exist under test/fixtures/, split into the FLAG side (the
     * rule fires on these) and the must-NOT-flag side (the rule must stay silent on these).
     * A rule lacking one side lists the other (or, for a documented gap, neither); a path is
     * never invented. `flag` empty + `noFlag` empty = a rule with no fixture case at all.
     */
    flag: string[];
    /** Fixture cases the rule must NOT flag (the negative control); empty when it has none. */
    noFlag: string[];
  }>;
}
