/**
 * S06 step 2 + 4: the model stages. The draft (Sonnet via the `claude` CLI) and the judge (Opus via
 * the same CLI) run HERE, on our side, when a library ships a new major — never in a user's free
 * scan. Their model ids come from env vars and are clamped the same way the evolve loop clamps its
 * fixer/reviewer (FORBIDDEN_MODEL_RE + ALLOWED_MODELS in src/evolve-guard.ts): a fable/mythos id or
 * an off-allowlist id falls back to the default, so a bad env value can't reach the CLI.
 */
import fs from "node:fs";
import { runAgentBackend, type ExecResult } from "../exec.js";
import { ALLOWED_MODELS, FORBIDDEN_MODEL_RE } from "../evolve-guard.js";
import type { Evidence, DraftAnswer, Candidate, JudgeVerdict, BuildReport, DslRule } from "./types.js";

/** The draft model's fallback when SHIM_PACKBUILDER_MODEL is unset. */
const DRAFT_DEFAULT = "claude-sonnet-5-5";
/** The builder's judge is Opus (the strongest model we may reach): falls back to Opus 5.5. */
const JUDGE_DEFAULT = "claude-opus-5-5";

/**
 * The smallest helper that applies evolve-guard's check to one model id: a fable/mythos id or an
 * id off the allowlist is clamped to `fallback`. Returns the chosen id plus a note when it clamped.
 */
export function clampOneModel(id: string | undefined, fallback: string): { model: string; clamped: boolean } {
  if (id == null || id.trim() === "") return { model: fallback, clamped: false };
  const m = id.trim();
  if (FORBIDDEN_MODEL_RE.test(m) || !ALLOWED_MODELS.includes(m)) return { model: fallback, clamped: true };
  return { model: m, clamped: false };
}

/** The draft model from SHIM_PACKBUILDER_MODEL, clamped (fable/mythos or off-list -> the Sonnet default). */
export function packBuilderModel(): { model: string; clamped: boolean } {
  return clampOneModel(process.env.SHIM_PACKBUILDER_MODEL, DRAFT_DEFAULT);
}
/** The builder judge from SHIM_JUDGE_MODEL, clamped to the Opus default. */
export function packJudgeModel(): { model: string; clamped: boolean } {
  return clampOneModel(process.env.SHIM_JUDGE_MODEL, JUDGE_DEFAULT);
}

/** Read the changelog file the user passed (--changelog) and return its text. */
export function readChangelog(file: string): string {
  return fs.readFileSync(file, "utf8");
}

/**
 * The draft stage: one headless Sonnet call that turns the evidence into candidate rules (or
 * honest skips). It writes each candidate's fixtures into the pack's `fixtures/` dir and returns
 * the structured answers. Runs in outDir so any files it touches stay inside `--out`.
 */
export async function runDraft(evidence: Evidence, outDir: string, model: string, changelogFile?: string): Promise<ExecResult> {
  const prompt = draftPrompt(evidence, changelogFile, outDir);
  const args = [
    "-p", prompt,
    "--model", model,
    "--max-turns", "30",
    "--permission-mode", "acceptEdits",
    "--allowedTools", "Read", "Write", "Glob", "Grep",
    "--output-format", "json",
  ];
  return runAgentBackend(args, outDir, 30 * 60_000, prompt);
}

/** The evidence lines the draft decides on: every diff row plus the cited changelog heading. */
function evidenceLines(e: Evidence): string[] {
  const lines: string[] = [];
  for (const r of e.diff.removed) lines.push(`removed ${r.name}  (was: ${r.signature})  [${r.file}]`);
  for (const c of e.diff.changed) lines.push(`changed ${c.name}  ${c.fromSig}  ->  ${c.toSig}`);
  for (const a of e.diff.added) lines.push(`added ${a.name}  [${a.file}]`);
  return lines;
}

function draftPrompt(e: Evidence, changelogFile: string | undefined, outDir: string): string {
  const lines = evidenceLines(e);
  return [
    `You are writing a migration "pack" for a TypeScript library: the package ${e.package} from version ${e.from} to ${e.to}.`,
    "For EACH breaking change below, produce either a candidate rule or an honest skip. The rule must be",
    "statically detectable in user code (no type-checker calls, no runtime). If a change is LOUD (it fails to",
    "compile or run, so tsc or a test already catches it) or is not statically detectable, skip it and say why.",
    "",
    "Breaking changes (from the exported .d.ts diff):",
    ...lines.map((l) => `- ${l}`),
    "",
    changelogFile ? `Changelog / migration-guide text is at ${changelogFile}; cite the exact line a rule encodes in its "evidence" field.` : "No changelog supplied.",
    "",
    "Write each candidate rule's fixtures to disk FIRST: `__fixtures__/flag_<ruleid>.ts` (code the rule must",
    "flag, with a `// FLAG` trailing comment on the flagged line) and `__fixtures__/noflag_<ruleid>.ts` (code the",
    "rule must NOT flag, with a `// OK` comment on the line). Use the real import of ${e.package} and realistic",
    "values. Then output ONLY a JSON array of answers, one per breaking change, and nothing after it.",
    "",
    'Shape of each answer: {"evidence":"<the diff line or changelog line this encodes>","rule":{...DslRule...}}',
    "for a candidate, or {\"evidence\":\"...\",\"skip\":\"loud|static|other\",\"skipReason\":\"...\"} for a skip.",
    "DslRule fields: id (kebab-case), package, import:{specifier,bindings}, detect:{kind:chain|recordArgs|objectField|propAccess,...}, emit:{severity,fix,message,rewrite?}.",
    "The DSL interpreter supports these detect kinds: chain (.method on an imported z-binding chain, with optional",
    "root/chainBefore/receiverIs/argCount/arg0Root/fieldValueRoot/guardMethods filters), recordArgs (z.record(A,B)),",
    "objectField (a z.object field whose value is rooted at X), propAccess (.errors on a safeParse error / narrowed id).",
  ].join("\n");
}

/** Parse the draft's JSON answer array out of a CLI run; [] when the run produced no parsable JSON. */
export function parseDraft(res: ExecResult): DraftAnswer[] {
  const text = res.text ?? res.output;
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? (arr as DraftAnswer[]) : [];
  } catch {
    return [];
  }
}

/**
 * The judge stage: for each admission-admitted rule, one headless Opus call compares the rule to its
 * cited evidence and answers ADMIT or REJECT with one reason. Strict: a rule that detects something
 * the evidence does not say changed is a REJECT. Returns one verdict per rule.
 */
export async function runJudge(cands: Candidate[], model: string, outDir: string): Promise<JudgeVerdict[]> {
  if (cands.length === 0) return [];
  const lines = cands.map((c) => `- ${c.rule.id}: encodes "${c.evidence}"\n  detect=${JSON.stringify(c.rule.detect)} emit=${JSON.stringify(c.rule.emit)}`).join("\n");
  const pkg = cands[0]?.rule.package ?? "?";
  const prompt = [
    `A migration pack for ${pkg} was generated from public evidence. Judge each admitted`,
    "rule strictly. ADMIT only if the rule detects exactly a change the cited evidence states. REJECT if it",
    "detects something the evidence does not say changed, or the evidence line does not back the rule.",
    "",
    "Admitted rules:",
    lines,
    "",
    'Output ONLY a JSON array: [{"ruleId":"...","admit":true|false,"reason":"<one sentence>"}]. Nothing after it.',
  ].join("\n");
  const args = [
    "-p", prompt,
    "--model", model,
    "--max-turns", "10",
    "--allowedTools", "Read",
    "--output-format", "json",
  ];
  const res = await runAgentBackend(args, outDir, 20 * 60_000, prompt);
  const text = res.text ?? res.output;
  const m = text.match(/\[[\s\S]*\]/);
  const parsed: Array<{ ruleId: string; admit: boolean; reason: string }> = [];
  if (m) {
    try {
      const arr = JSON.parse(m[0]);
      if (Array.isArray(arr)) parsed.push(...(arr as typeof parsed));
    } catch {}
  }
  const byId = new Map(parsed.map((p) => [p.ruleId, p]));
  // A rule the judge did not return gets REJECT (strict: no verdict = not admitted).
  return cands.map((c) => {
    const v = byId.get(c.rule.id);
    return { ruleId: c.rule.id, admit: v?.admit ?? false, reason: v?.reason ?? "judge gave no verdict", cost: res.cost ?? null };
  });
}
