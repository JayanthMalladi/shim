/**
 * S06: types for the offline pack builder. The builder turns public evidence (a library's
 * changelog + the .d.ts diff between two majors) into a *candidate* pack: a declarative record
 * plus the deterministic rule code it points at. A candidate becomes a real pack only after it
 * passes the admission harness, the Opus judge, and Jayanth's review — the builder itself never
 * writes into src/packs/.
 */

/** One row of the .d.ts surface diff the evidence stage emits. */
export interface SurfaceExport {
  /** The exported symbol name. */
  name: string;
  /** Normalized declaration text (whitespace collapsed, comments stripped). */
  signature: string;
  /** The .d.ts file it came from, relative to the package root. */
  file: string;
}

/** The exported type surface of one package version. */
export interface Surface {
  version: string;
  /** The .d.ts files that were parsed (relative to the package root). */
  files: string[];
  exports: SurfaceExport[];
}

/** The deterministic diff of two surfaces: what a new major removed, added, or changed. */
export interface SurfaceDiff {
  /** Exported in `from`, absent in `to` — the code that referenced it now fails to compile. */
  removed: SurfaceExport[];
  /** Exported in `to`, absent in `from`. */
  added: SurfaceExport[];
  /** Exported in both, but the declaration changed. */
  changed: Array<{ name: string; fromSig: string; toSig: string; file: string }>;
}

/** evidence.json — the input to the draft stage. Deterministic: no model, no target-repo. */
export interface Evidence {
  package: string;
  from: string;
  to: string;
  /** The .d.ts surface of each version. */
  fromSurface: Surface;
  toSurface: Surface;
  diff: SurfaceDiff;
  /** The changelog / migration-guide text the user supplied (--changelog), verbatim or truncated. */
  changelog?: string;
  /** Where the two tarballs were unpacked, for provenance in the build report. */
  fromDir?: string;
  toDir?: string;
}

/**
 * The restricted DSL a candidate rule is expressed in. The draft model emits these; the
 * interpreter (interpret.ts) turns them into ts-morph findings + edits; the admission harness
 * decides whether one is allowed to ship. A rule that can't be described in the DSL is a "skip",
 * not a hand-written ts-morph rule — the DSL is the contract.
 */
export interface DslRule {
  /** The rule id (kebab-case), e.g. "zod-uuid-strict". */
  id: string;
  /** The package the rule is gated to ("zod"); only files that import it are scanned. */
  package: string;
  /** The import specifier that binds the local names the rule matches on. */
  import: {
    specifier: string;
    /** Local names that count (default import, `z` named import, namespace import, aliases). */
    bindings?: string[];
  };
  /** A file-level gate: the file must reference this identifier for the rule to fire. */
  gates?: { fileReferences?: string };
  detect: Detect;
  emit: Emit;
  /** The evidence line (diff export or changelog excerpt) this rule encodes. */
  evidence: string;
}

export interface Detect {
  kind: "chain" | "recordArgs" | "objectField" | "propAccess";
  // chain: `.method(...)` on a chain rooted at a detected binding.
  method?: string;
  /** First method from the binding, e.g. "string", "object", "coerce". */
  root?: string;
  /** Require one of these methods to appear earlier in the chain (R2 transforms). */
  chainBefore?: string[];
  /** For optional/nullish: the receiver must be a `.default()` call (R1). */
  receiverIs?: string;
  // recordArgs: z.record(A, B) — arg0's root is one of these.
  argCount?: number;
  arg0Root?: string[];
  // objectField: a field of z.object({...}) whose value is rooted at one of these.
  fieldOf?: string;
  fieldValueRoot?: string[];
  /** R6: reject when any of these guard methods are present. */
  guardMethods?: string[];
  // propAccess: `<x>.<prop>` — the receiver shape.
  prop?: string;
  receiverShape?: "safeParseError" | "narrowed";
}

export interface Emit {
  severity: "break" | "silent" | "deprecated";
  fix: "auto" | "agent" | "manual";
  message: string;
  rewrite?: Rewrite;
}

export interface Rewrite {
  node: "method" | "call" | "field" | "prop";
  /** Replace the method/prop name (e.g. "default"->"prefault", "uuid"->"guid"). */
  replaceMethod?: string;
  /** Insert after the node (R5: append ".optional()"). */
  appendAfter?: string;
  /** Replace the whole `.default(X)` call node with its receiver (R1). */
  dropCallKeepReceiver?: boolean;
}

/** The draft model's answer for one breaking change: a candidate rule, or an honest skip. */
export interface DraftAnswer {
  /** The evidence line this answer is about. */
  evidence: string;
  /** Present for a candidate rule; absent for a skip. */
  rule?: DslRule;
  /** Present for a skip: why no static rule (loud/tsc-catches it, or not statically detectable). */
  skip?: "loud" | "static" | "other";
  skipReason?: string;
}

/** A candidate rule the draft produced, with its fixtures and evidence citation. */
export interface Candidate {
  rule: DslRule;
  /** TS code the rule must flag (written to the pack's fixture dir). */
  flagFixture: string;
  /** TS code the rule must NOT flag (the negative control). */
  noFlagFixture: string;
  evidence: string;
}

/** The admission verdict for one candidate. */
export interface AdmissionResult {
  ruleId: string;
  admitted: boolean;
  /** Why, when rejected (or a short confirmation when admitted). */
  reasons: string[];
}

/** The per-rule judge verdict. */
export interface JudgeVerdict {
  ruleId: string;
  admit: boolean;
  reason: string;
  /** The judge's cost (USD) or null when unpriced. */
  cost: number | null;
}

/** The result of one build-pack run, written next to the candidate pack. */
export interface BuildReport {
  package: string;
  from: string;
  to: string;
  /** What the draft produced and what it skipped. */
  candidates: number;
  skips: Array<{ evidence: string; reason: string }>;
  /** Rules that survived the deterministic admission harness. */
  admitted: string[];
  /** Rules the judge admitted / rejected, with its one-line reason. */
  judged: JudgeVerdict[];
  /** The rules in the emitted manifest (admitted AND judged-in). */
  shipped: string[];
  /** Total draft+judge cost, or null when unpriced. */
  cost: number | null;
  /** The draft model id that ran (post-allowlist-clamp). */
  draftModel: string;
  judgeModel: string;
}
