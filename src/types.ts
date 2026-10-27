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
