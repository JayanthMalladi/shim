#!/usr/bin/env node
/**
 * Evolve Shim's fix-stage architecture, AlphaEvolve style: keep an archive of scored variants, ask an
 * LLM to propose a child of a strong parent given everyone's results, score the child on the same
 * prepared repos, and repeat. Every variant and its numbers are logged.
 *
 *   tsx src/evolve.ts --bench <dir> --repos a,b,c --out <dir> [--hours 6] [--concurrency 2] [--set dev]
 *
 * Score = repos where the variant opens a PR (gates hold, no breaking findings) AND the fixed judge
 * approves the diff. The judge never changes, so a variant can't win by weakening its own reviewer.
 */
import fs from "node:fs";
import path from "node:path";
import { SEEDS, V2, type Architecture } from "./arch.js";
import { copyRepo } from "./copy.js";
import { runAsync, runClaude } from "./exec.js";

interface RepoResult {
  repo: string;
  verdict: string;
  reason: string;
  judge?: { approve: boolean; issues: string[]; cost?: number };
  cost?: number;
  fixMs?: number;
  candidates?: unknown[];
  diffStat?: string;
  error?: string;
}

interface Evaluation {
  arch: Architecture;
  parent?: string;
  set: string;
  results: RepoResult[];
  /** PRs the judge approved. */
  shipped: number;
  /** PRs by gates alone (what the pipeline would open without the judge). */
  gatePass: number;
  /** Gate-passing PRs the judge rejected: the ones that would have embarrassed us. */
  falsePass: number;
  cost: number;
  minutes: number;
  at: string;
  invalid?: string;
}

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const bench = path.resolve(flag("--bench")!);
const repos = flag("--repos")!.split(",");
const out = path.resolve(flag("--out")!);
const set = flag("--set", "dev")!;
const deadline = Date.now() + Number(flag("--hours", "6")) * 3600_000;
const concurrency = Number(flag("--concurrency", "2"));
const only = flag("--only"); // evaluate one archived arch id on this set, then exit
const mirror = flag("--mirror"); // a second folder to copy the logs into
const SHIM = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ARCHIVE = path.join(out, "archive.jsonl");
const log = (m: string) => console.error(`[evolve ${new Date().toISOString().slice(11, 19)}] ${m}`);

fs.mkdirSync(out, { recursive: true });

function readArchive(): Evaluation[] {
  if (!fs.existsSync(ARCHIVE)) return [];
  return fs.readFileSync(ARCHIVE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }));
  return results;
}

const RATE_LIMIT = /hit your (session|usage|weekly) limit|usage limit reached|rate_limit_error|overloaded_error/i;

async function evaluate(arch: Architecture, parent: string | undefined): Promise<Evaluation> {
  const started = Date.now();
  const runRoot = path.join(out, "runs", arch.id);
  fs.mkdirSync(runRoot, { recursive: true });
  fs.writeFileSync(path.join(runRoot, "arch.json"), JSON.stringify(arch, null, 2));
  const results = await pool(repos, concurrency, async (repo): Promise<RepoResult> => {
    const rdir = path.join(runRoot, repo);
    const work = path.join(rdir, "repo");
    // Resume: a repo this architecture already finished (before the run was interrupted) is not redone.
    const done = path.join(rdir, "result.json");
    if (fs.existsSync(done)) {
      const r: RepoResult = JSON.parse(fs.readFileSync(done, "utf8"));
      if (!r.error) {
        log(`${arch.id} / ${repo}: reusing finished result`);
        return r;
      }
    }
    fs.rmSync(rdir, { recursive: true, force: true });
    fs.mkdirSync(rdir, { recursive: true });
    copyRepo(path.join(bench, repo, "repo"), work);
    log(`${arch.id} / ${repo}: start`);
    const res = await runAsync(
      "npx",
      ["tsx", "src/cli.ts", "finish", work, "--prep", path.join(bench, repo, "prepared.json"), "--arch", path.join(runRoot, "arch.json"), "--out", rdir, "--judge"],
      SHIM,
      6 * 3600_000,
    );
    fs.writeFileSync(path.join(rdir, "finish.log"), res.output);
    for (const d of fs.readdirSync(rdir)) if (d === "repo" || d.startsWith("repo.cand")) fs.rmSync(path.join(rdir, d), { recursive: true, force: true });
    const resultFile = path.join(rdir, "result.json");
    if (!fs.existsSync(resultFile)) return { repo, verdict: "error", reason: res.output.slice(-400), error: "no result" };
    const r: RepoResult = JSON.parse(fs.readFileSync(resultFile, "utf8"));
    const report = fs.readFileSync(path.join(rdir, "report.json"), "utf8");
    if (RATE_LIMIT.test(report) && r.verdict !== "open-pr") r.error = "rate limited";
    if (r.error) fs.writeFileSync(resultFile, JSON.stringify(r, null, 2));
    log(`${arch.id} / ${repo}: ${r.verdict}${r.judge ? ` judge=${r.judge.approve}` : ""} $${(r.cost ?? 0).toFixed(2)}`);
    return r;
  });
  const gatePass = results.filter((r) => r.verdict === "open-pr").length;
  const shipped = results.filter((r) => r.verdict === "open-pr" && r.judge?.approve).length;
  const limited = results.filter((r) => r.error === "rate limited" || r.error === "no result");
  return {
    arch, parent, set, results, shipped, gatePass, falsePass: gatePass - shipped,
    cost: results.reduce((s, r) => s + (r.cost ?? 0) + (r.judge?.cost ?? 0), 0),
    minutes: Math.round((Date.now() - started) / 60_000),
    at: new Date().toISOString(),
    invalid: limited.length ? `${limited.length} repos errored or rate limited: ${limited.map((r) => r.repo).join(", ")}` : undefined,
  };
}

const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"];

function clamp(a: Partial<Architecture>, id: string, notes: string): Architecture {
  const int = (v: unknown, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, Math.round(Number(v ?? d)) || d));
  const text = (v: unknown, d: string) => (typeof v === "string" && v.trim().length > 40 ? v.slice(0, 5000) : d);
  return {
    id, notes,
    candidates: int(a.candidates, 1, 3, V2.candidates),
    attempts: int(a.attempts, 1, 3, V2.attempts),
    fixerModel: MODELS.includes(a.fixerModel ?? "") ? a.fixerModel! : V2.fixerModel,
    fixerMaxTurns: int(a.fixerMaxTurns, 10, 60, V2.fixerMaxTurns),
    fixerRules: text(a.fixerRules, V2.fixerRules),
    fixerChecks: !!a.fixerChecks,
    audit: !!a.audit,
    review: a.review !== false,
    reviewerModel: MODELS.includes(a.reviewerModel ?? "") ? a.reviewerModel! : V2.reviewerModel,
    reviewerRules: text(a.reviewerRules, V2.reviewerRules),
    reviewRounds: int(a.reviewRounds, 0, 2, 0),
    selection: a.selection === "first" ? "first" : "smallest",
  };
}

const rankKey = (e: Evaluation) => [-e.shipped, e.falsePass, e.cost];
const byRank = (a: Evaluation, b: Evaluation) => {
  const [x, y] = [rankKey(a), rankKey(b)];
  const i = x.findIndex((v, k) => v !== y[k]);
  return i < 0 ? 0 : x[i]! - y[i]!;
};

/** Ask an LLM for one child architecture, given the whole archive and a chosen parent. */
async function mutate(archive: Evaluation[], gen: number): Promise<{ arch: Architecture; parent: string }> {
  const ranked = archive.filter((e) => !e.invalid && e.set === set).sort(byRank);
  const parent = Math.random() < 0.7 ? ranked[0]! : ranked[Math.floor(Math.random() * Math.min(3, ranked.length))]!;
  const table = ranked.map((e) =>
    `- ${e.arch.id} (parent ${e.parent ?? "seed"}): shipped ${e.shipped}/${e.results.length}, gate-pass ${e.gatePass}, false-pass ${e.falsePass}, $${e.cost.toFixed(2)}, ${e.minutes} min. ${e.arch.notes}\n` +
    e.results.map((r) => `    ${r.repo}: ${r.verdict}${r.judge ? (r.judge.approve ? ", judge approved" : `, judge rejected: ${r.judge.issues.join("; ").slice(0, 400)}`) : ""}${r.verdict !== "open-pr" ? ` (${r.reason.slice(0, 300)})` : ""}`).join("\n"),
  ).join("\n");
  const { id: _id, notes: _notes, ...genome } = parent.arch;
  const prompt = `You are improving Shim, a tool that upgrades open-source repos from Vercel AI SDK 6 to 7 and opens a PR
only when the upgrade is safe. Its deterministic stage (version bump, official codemod, rule-based fixes) is fixed.
You are evolving the FIX STAGE: LLM fixer agents that repair what is left, plus an optional internal reviewer.

Each architecture is scored on the same ${repos.length} prepared repos. Score = repos where Shim opens a PR (every check
that passed before still passes, no breaking findings left, internal reviewer approves if enabled) AND a fixed,
strict judge agent approves the final diff. "false-pass" = PRs the gates allowed but the judge rejected. Lower cost
breaks ties. The judge checks: behavior preserved (multi-step usage/toolCalls/content must read finalStep;
response.messages -> responseMessages; system messages -> instructions), no unrelated edits, no weakened tests,
no signature changes, no code that can't compile, no renamed exports.

Genome fields:
- candidates (1-3): parallel fixers on separate copies; attempts (1-3): fix->gates rounds per candidate.
- fixerModel / reviewerModel: one of ${MODELS.join(", ")} (sonnet is cheaper, opus stronger).
- fixerMaxTurns (10-60).
- fixerRules: the rules text the fixer gets above its findings and failing checks. You may rewrite it.
- fixerChecks: if true, the fixer may run the repo's own build/typecheck/test commands (the same ones the gates
  run) to verify its work; otherwise it can only run tsc. Slower, but it sees test and build failures directly.
- audit: if true, the fixer also audits every generateText/streamText/Agent call for silent v7 changes, even
  with no findings (catches scanner misses, costs more, risks unrelated edits).
- review: internal reviewer gate; reviewerRules: its rules text (you may rewrite it); reviewRounds (0-2): how
  many times reviewer issues go back to the same candidate's fixer.
- selection: "smallest" (smallest passing diff) or "first".

Archive so far (best first), with per-repo outcomes:
${table}

Parent for this child: ${parent.arch.id}
${JSON.stringify(genome, null, 2)}

Raw run folders are under ./runs/<arch id>/<repo>/ (report.json, result.json, changes.patch, finish.log) if you
want to look at why a repo failed. Propose ONE child that you expect to ship more repos, or the same number for
less money. Change what the evidence points to; small targeted edits to the rules text are fine. Do not overfit
to one repo's file names: the rules must work on any repo.

Reply with a short hypothesis paragraph, then the child genome as a single \`\`\`json block with all fields.`;
  const res = await runClaude(["-p", prompt, "--model", "claude-opus-5-5", "--max-turns", "25", "--allowedTools", "Read", "Glob", "Grep", "--output-format", "json"],
    out,
    20 * 60_000,
  );
  const text = res.text ?? res.output;
  const json = text.match(/```json\s*([\s\S]*?)```/)?.[1];
  const hypothesis = text.split("```")[0]!.trim().replace(/\s+/g, " ").slice(0, 600);
  let child: Partial<Architecture> = {};
  try {
    child = JSON.parse(json ?? "{}");
  } catch {
    log("mutator returned no parsable genome; using parent with feedback rounds toggled");
    child = { ...genome, reviewRounds: genome.reviewRounds ? 0 : 1 };
  }
  const id = `g${gen}-${parent.arch.id.split("-")[0]}-${Math.random().toString(36).slice(2, 6)}`;
  fs.writeFileSync(path.join(out, `mutation-${id}.txt`), `${prompt}\n\n=== RESPONSE ===\n${text}`);
  return { arch: clamp(child, id, `child of ${parent.arch.id}. ${hypothesis}`), parent: parent.arch.id };
}

function writeLog(archive: Evaluation[]) {
  const valid = archive.filter((e) => !e.invalid);
  const sets = [...new Set(valid.map((e) => e.set))];
  const lines = [
    "# Shim architecture evolution log",
    "",
    `Updated ${new Date().toISOString()}. Score = PRs the fixed judge approves. Gate-pass = PRs by checks alone. False-pass = gate-pass the judge rejected.`,
    "",
  ];
  for (const s of sets) {
    const rows = valid.filter((e) => e.set === s).sort(byRank);
    const repoNames = [...new Set(rows.flatMap((e) => e.results.map((r) => r.repo)))];
    lines.push(`## ${s} set (${repoNames.length} repos)`, "", "| Rank | Architecture | Parent | Shipped | Gate-pass | False-pass | Cost | Minutes |", "|---|---|---|---|---|---|---|---|");
    rows.forEach((e, i) => lines.push(`| ${i + 1} | ${e.arch.id} | ${e.parent ?? "seed"} | ${e.shipped}/${e.results.length} | ${e.gatePass} | ${e.falsePass} | $${e.cost.toFixed(2)} | ${e.minutes} |`));
    lines.push("", "Per repo (P = shipped, p = gate-pass but judge rejected, i = issue, e = error):", "", `| Architecture | ${repoNames.join(" | ")} |`, `|---|${repoNames.map(() => "---").join("|")}|`);
    for (const e of rows) {
      const cell = (n: string) => {
        const r = e.results.find((x) => x.repo === n);
        if (!r) return "";
        if (r.verdict === "open-pr") return r.judge?.approve ? "P" : "p";
        return r.verdict === "open-issue" ? "i" : "e";
      };
      lines.push(`| ${e.arch.id} | ${repoNames.map(cell).join(" | ")} |`);
    }
    lines.push("");
  }
  lines.push("## Every architecture tried", "");
  for (const e of archive) {
    const { id, notes, fixerRules, reviewerRules, ...knobs } = e.arch;
    lines.push(`### ${id}${e.invalid ? " (invalid run)" : ""}`, "", notes, "", `Set ${e.set}; shipped ${e.shipped}/${e.results.length}; $${e.cost.toFixed(2)}; ${e.minutes} min; ${e.at}${e.invalid ? `; ${e.invalid}` : ""}`, "", "```json", JSON.stringify(knobs), "```", "");
    if (fixerRules !== V2.fixerRules) lines.push("<details><summary>fixer rules</summary>", "", "```", fixerRules, "```", "</details>", "");
    if (reviewerRules !== V2.reviewerRules) lines.push("<details><summary>reviewer rules</summary>", "", "```", reviewerRules, "```", "</details>", "");
  }
  fs.writeFileSync(path.join(out, "LOG.md"), lines.join("\n"));
  if (mirror) {
    fs.mkdirSync(mirror, { recursive: true });
    fs.copyFileSync(path.join(out, "LOG.md"), path.join(mirror, "LOG.md"));
    fs.copyFileSync(ARCHIVE, path.join(mirror, "archive.jsonl"));
  }
}

async function main() {
  if (only) {
    const arch = readArchive().find((e) => e.arch.id === only)?.arch ?? SEEDS.find((a) => a.id === only);
    if (!arch) throw new Error(`no arch ${only}`);
    const ev = await evaluate(arch, undefined);
    fs.appendFileSync(ARCHIVE, `${JSON.stringify(ev)}\n`);
    writeLog(readArchive());
    return;
  }
  let gen = readArchive().length;
  while (Date.now() < deadline) {
    const archive = readArchive();
    const done = new Set(archive.filter((e) => !e.invalid && e.set === set).map((e) => e.arch.id));
    // Only start an evaluation that can finish before the deadline (the caller may be killed at it).
    // Interrupted evaluations resume, so only a rough estimate is needed here.
    const estimate = 10 * 60_000;
    if (Date.now() + estimate > deadline) {
      log(`stopping: next evaluation (~${Math.round(estimate / 60_000)} min) would pass the deadline`);
      break;
    }
    const seed = SEEDS.find((a) => !done.has(a.id));
    // A child proposed before an interruption is evaluated before proposing a new one.
    const PENDING = path.join(out, "pending.json");
    const pending = !seed && fs.existsSync(PENDING) ? JSON.parse(fs.readFileSync(PENDING, "utf8")) : undefined;
    const { arch, parent } = seed ? { arch: seed, parent: undefined } : pending ?? (await mutate(archive, ++gen));
    if (!seed) fs.writeFileSync(PENDING, JSON.stringify({ arch, parent }));
    log(`evaluating ${arch.id} on ${set}: ${arch.notes.slice(0, 160)}`);
    const ev = await evaluate(arch, parent);
    fs.appendFileSync(ARCHIVE, `${JSON.stringify(ev)}\n`);
    fs.rmSync(PENDING, { force: true });
    writeLog(readArchive());
    log(`${arch.id}: shipped ${ev.shipped}/${ev.results.length}, gate-pass ${ev.gatePass}, $${ev.cost.toFixed(2)}, ${ev.minutes} min${ev.invalid ? `, INVALID ${ev.invalid}` : ""}`);
    if (ev.invalid) {
      log("pausing 20 minutes for rate limits");
      await new Promise((r) => setTimeout(r, 20 * 60_000));
    }
  }
}

await main();
