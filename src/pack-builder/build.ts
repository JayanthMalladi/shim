/**
 * S06: the build-pack orchestrator. Runs the five stages in order — evidence (deterministic),
 * draft (Sonnet), admission harness (deterministic), judge (Opus), output — and writes a candidate
 * pack under `--out`. It never writes into src/packs/: the pack ships only after Jayanth's review.
 *
 * The model stages run on OUR side (a library ships a new major); they never run in a user's free
 * scan. Cost is real here: draft + judge are headless `claude` CLI calls, priced unless the backend
 * is unpriced (dsh / ANTHROPIC_BASE_URL).
 */
import fs from "node:fs";
import path from "node:path";
import { buildEvidence } from "./evidence.js";
import { interpretRule } from "./interpret.js";
import { admitCandidates, genFlagName, genNoFlagName } from "./harness.js";
import { packBuilderModel, packJudgeModel, runDraft, runJudge, parseDraft, readChangelog } from "./model.js";
import { emitManifest, writePack } from "./output.js";
import type { BuildReport, Candidate } from "./types.js";

export interface BuildPackOptions {
  package: string;
  from: string;
  to: string;
  outDir: string;
  /** The changelog / migration-guide text file the user supplied. Optional but strongly advised. */
  changelog?: string;
  /** The real pack fixture dirs used as the cross-pack negative control (test/fixtures/*). */
  fixtureDirs?: string[];
  /** Skip the model stages entirely: build evidence + run a supplied candidate set through the harness. */
  candidates?: Candidate[];
  /** The draft/judge model ids to run with (defaults from env / clamped). */
  models?: { draft: string; judge: string };
}

/**
 * One build-pack run. Returns the build report. When `candidates` is supplied the draft stage is
 * skipped (used by the harness's own "plant a bad rule" test and by offline re-scores); otherwise
 * the draft model authors the candidates from the evidence.
 */
export async function buildPack(opts: BuildPackOptions): Promise<BuildReport> {
  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const changelogText = opts.changelog ? readChangelog(opts.changelog) : undefined;

  // 1. Evidence — deterministic, no model, no target-repo.
  const evidence = buildEvidence({
    package: opts.package,
    from: opts.from,
    to: opts.to,
    outDir,
    changelog: changelogText,
    keep: true, // keep the unpacked tarballs: H2's type-diff check inspects them.
  });
  fs.writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify(evidence, null, 2), "utf8");

  // 2. Draft — the model authors candidate rules + fixtures (or a supplied candidate set).
  let cands: Candidate[];
  let skips: BuildReport["skips"];
  let draftModel = opts.models?.draft ?? packBuilderModel().model;
  let judgeModel = opts.models?.judge ?? packJudgeModel().model;
  let draftCost: number | null = null;
  if (opts.candidates) {
    cands = opts.candidates;
    skips = [];
  } else {
    const res = await runDraft(evidence, outDir, draftModel, opts.changelog);
    draftCost = res.cost ?? null;
    const answers = parseDraft(res);
    cands = toCandidates(answers, outDir);
    skips = answers.filter((a) => a.skip).map((a) => ({ evidence: a.evidence, reason: a.skipReason ?? a.skip ?? "skipped" }));
  }

  // 3. Admission harness — deterministic; a broken rule must fail at least one check.
  const admissions = admitCandidates(cands, opts.fixtureDirs ?? []);
  const admittedIds = new Set(admissions.filter((a) => a.admitted).map((a) => a.ruleId));
  const admitted = cands.filter((c) => admittedIds.has(c.rule.id));

  // 4. Judge — strict per-rule ADMIT/REJECT against the cited evidence.
  const judged = await runJudge(admitted, judgeModel, outDir);
  const judgedIn = new Set(judged.filter((j) => j.admit).map((j) => j.ruleId));

  // 5. Output — a candidate pack, not registered; Jayanth copies it in after review.
  const shipped = admitted.filter((c) => judgedIn.has(c.rule.id));
  const manifest = emitManifest({
    id: `${opts.package.replace("@", "").replace("/", "-")}-pack`,
    package: opts.package,
    from: opts.from,
    to: opts.to,
    rules: shipped,
  });
  const report: BuildReport = {
    package: opts.package,
    from: opts.from,
    to: opts.to,
    candidates: cands.length,
    skips,
    admitted: [...admittedIds],
    judged,
    shipped: manifest.rules.map((r) => r.id),
    cost: draftCost,
    draftModel,
    judgeModel,
  };
  writePack(outDir, manifest, shipped.map((c) => c.rule), shipped, report);
  fs.writeFileSync(path.join(outDir, "build-report.json"), JSON.stringify(report, null, 2), "utf8");
  return report;
}

/** Turn draft answers into Candidates, reading the model-written fixtures; reject a candidate whose fixtures are missing. */
function toCandidates(answers: import("./types.js").DraftAnswer[], outDir: string): Candidate[] {
  const out: Candidate[] = [];
  for (const a of answers) {
    if (!a.rule) continue;
    const flagPath = path.join(outDir, "__fixtures__", genFlagName(a.rule.id));
    const noPath = path.join(outDir, "__fixtures__", genNoFlagName(a.rule.id));
    if (!fs.existsSync(flagPath) || !fs.existsSync(noPath)) continue; // no fixtures -> the harness can't grade it
    out.push({
      rule: a.rule,
      flagFixture: fs.readFileSync(flagPath, "utf8"),
      noFlagFixture: fs.readFileSync(noPath, "utf8"),
      evidence: a.evidence,
    });
  }
  return out;
}

/** Re-export the interpreter so the candidate rules module and the harness share one path. */
export { interpretRule };
