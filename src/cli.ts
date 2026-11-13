#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { discover } from "./discover.js";
import { judgeModel, runJudge } from "./agent.js";
import { agentBackend, agentPreflight } from "./exec.js";
import { DEFAULT_ARCH, type Architecture } from "./arch.js";
import { getMigration } from "./migrations.js";
import { finish, migrate, prepare } from "./pipeline.js";
import { execFileSync } from "node:child_process";
import { scan, scanAndFix, scanWith, scanAndFixWith } from "./scan.js";
import { prOpen, prRecord } from "./pr.js";
import { writeStats } from "./stats.js";
import { triage } from "./triage.js";
import { prStatus } from "./pr-status.js";
import { scoreTargets } from "./score-targets.js";
import { buildExposureReport, formatFindings, renderReport } from "./exposure.js";
import { renderPacksTable } from "./packs.js";

const USAGE = `shim <command>

  discover [days] [--migration <id>]
                           Find npm packages on ai@6 published in the last N days (default 60)
  triage <candidates.json> [--work <dir>] [--migration <id>]
                           Shallow-clone and scan each candidate (read-only)
  score <targets.json> [--prs <prs.csv>]
                           Rank triaged targets by merge likelihood (read-only GitHub
                           calls with GITHUB_TOKEN_READONLY); rewrites the file in place
  scan <dir> [--migration <id>] [--out <file>]
                           Exposure report: read the pins, run every matching pack, list
                           findings by severity (no changes, no model, no network);
                           --migration keeps the single-pack listing; --out writes it
  fix <dir> [--migration <id>]
                           Apply Shim's deterministic, behavior-preserving fixes
  migrate <dir> [--agent] [--out <dir>] [--repo <owner/name>] [--arch <arch.json>] [--migration <id>]
                           Full pipeline: baseline gates, bump, codemod, fixes,
                           optional fixer agent, gates again, report + PR body
  prepare <dir> --out <dir> [--repo <owner/name>] [--migration <id>]
                           Everything before the fix stage; writes prepared.json
  finish <dir> --prep <prepared.json> --out <dir> [--arch <arch.json>] [--judge] [--migration <id>]
                           The fix stage on a prepared repo; --judge adds the fixed judge's verdict
  pr open <draft-dir> --fork <forkOwner> [--allow-drift]
                           Replay the draft's changes.patch on a fresh shim/ai-sdk-7
                           branch of the fork, push it, and print the compare URL
  pr record <owner/repo> <pr-url>
                           Record the opened PR in data/prs.csv
  pr status [--write]      Refresh PR states from the GitHub API; print totals;
                           --write updates data/prs.csv
  stats [--csv <file>] [--out <file>]
                           Regenerate site/lib/stats.json from data/prs.csv
                           (the site's live numbers); commit it to redeploy
  packs
                           Print the pack-manifest table (the generated docs/PACKS.md),
                           so the doc can't drift from the code
  build-pack <package> --from <ver> --to <ver> --out <dir> [--changelog <file>]
                           S06: build a candidate pack from public evidence. Evidence is
                           deterministic (npm pack both majors + the .d.ts diff); the draft and
                           judge are model calls run here (SHIM_PACKBUILDER_MODEL / SHIM_JUDGE_MODEL),
                           never in a user's free scan. Writes a candidate pack under --out; it is
                           not registered in src/packs/ until you copy it in after review`;

const [cmd, target, ...rest] = process.argv.slice(2);
const loadArch = (): Architecture => {
  const f = rest.includes("--arch") ? rest[rest.indexOf("--arch") + 1] : undefined;
  return f ? { ...DEFAULT_ARCH, ...JSON.parse(fs.readFileSync(f, "utf8")) } : DEFAULT_ARCH;
};
const summarize = (p: import("./pipeline.js").Prepared) => ({
  repo: p.repo, findings: p.pre.length, agentFindings: p.pre.filter((f) => f.fix === "agent").length,
  baseline: Object.fromEntries(Object.entries(p.baseline).map(([k, v]) => [k, v.ok])),
  after: Object.fromEntries(Object.entries(p.after).map(([k, v]) => [k, v.ok])),
});
const flag = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const migFlag = (): import("./migrations.js").Migration["id"] | undefined => {
  const i = rest.indexOf("--migration");
  return i >= 0 ? (rest[i + 1] as import("./migrations.js").Migration["id"]) : undefined;
};

// `packs` takes no positional target: print the generated manifest table and exit.
if (cmd === "packs") {
  console.log(renderPacksTable());
  process.exit(0);
}

// `stats` takes no positional target: run it before the guard (which requires one) and exit.
if (cmd === "stats") {
  const csv = flag("--csv") ? path.resolve(flag("--csv")!) : undefined;
  const out = flag("--out") ? path.resolve(flag("--out")!) : undefined;
  const s = writeStats({ prCsv: csv, out });
  console.log(JSON.stringify(s, null, 2));
  process.exit(0);
}

if (!cmd || !target) {
  console.log(USAGE);
  process.exit(cmd ? 1 : 0);
}

switch (cmd) {
  case "scan": {
    if (migFlag()) {
      // --migration: single-migration mode, byte-for-byte the output it has always had.
      const m = getMigration(migFlag());
      const { result } = scanWith(target, m);
      console.log(formatFindings(result));
      break;
    }
    // No flags: the exposure report. Model-free and network-free — the only subprocess is the
    // local `git ls-files` in the source-file list (src/scan.ts). Lockfiles are read as text.
    // The report always prints to stdout; `--out <file>` additionally writes it to that file
    // (relative to CWD, the same convention as prepare/finish's --out). A bare `--out` with no
    // value writes nothing — the free scan must leave the scanned dir untouched.
    const report = renderReport(buildExposureReport(target));
    console.log(report);
    const out = flag("--out");
    if (out) fs.writeFileSync(path.resolve(out), report + "\n", "utf8");
    break;
  }
  case "fix": {
    const m = getMigration(migFlag());
    const { result, applied } = await scanAndFixWith(target, m);
    console.log(`${applied} auto-fixes applied; ${result.findings.filter((f) => f.fix !== "auto").length} findings need the agent or a human`);
    break;
  }
  case "migrate": {
    const arch = loadArch();
    if (rest.includes("--agent")) console.error(`[shim] ${agentPreflight({ fixer: arch.fixerModel, reviewer: arch.review ? arch.reviewerModel : undefined })}`);
    const report = await migrate(path.resolve(target), flag("--repo") ?? path.basename(target), {
      agent: rest.includes("--agent"),
      outDir: path.resolve(flag("--out") ?? path.join(target, "..", `${path.basename(target)}.shim`)),
      arch,
      migration: migFlag() ? getMigration(migFlag()) : undefined,
    });
    console.log(JSON.stringify({ verdict: report.verdict, reason: report.reason, autoFixed: report.autoFixed, remaining: report.remaining.length }, null, 2));
    break;
  }
  case "prepare": {
    const out = path.resolve(flag("--out") ?? `${target}.prep`);
    const m = migFlag() ? getMigration(migFlag()) : getMigration();
    const p = await prepare(path.resolve(target), flag("--repo") ?? path.basename(target), m);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "prepared.json"), JSON.stringify(p, null, 2));
    console.log(JSON.stringify("skip" in p ? { skip: p.skip } : summarize(p.prepared), null, 2));
    break;
  }
  case "finish": {
    const prep = JSON.parse(fs.readFileSync(flag("--prep")!, "utf8")).prepared;
    const out = path.resolve(flag("--out")!);
    const arch = loadArch();
    const judging = rest.includes("--judge");
    const migOverride = migFlag() ? getMigration(migFlag()) : undefined;
    console.error(`[shim] ${agentPreflight({ fixer: arch.fixerModel, reviewer: arch.review ? arch.reviewerModel : undefined, judge: judging ? judgeModel() : undefined })}`);
    const report = await finish(path.resolve(target), prep, { agent: true, outDir: out, arch, migration: migOverride });
    let judge;
    if (judging && report.verdict === "open-pr") {
      const j = await runJudge(path.resolve(target), migOverride ?? getMigration(prep.migration));
      // Keep the end of a rejection's output: "reviewer gave no verdict" alone can't tell a turn limit from a crash.
      judge = { approve: j.approve, issues: j.issues, cost: j.cost, ...(j.approve ? {} : { output: j.output.slice(-2000) }) };
    }
    const result = { repo: report.repo, arch: report.arch, verdict: report.verdict, reason: report.reason.slice(0, 600), judge, cost: report.cost, agent: report.agent && { ...report.agent, ...(judge && agentBackend() !== "dsh" ? { judgeModel: judgeModel() } : {}) }, fixMs: report.fixMs, candidates: report.candidates, diffStat: report.diffStat.split("\n").pop() };
    fs.writeFileSync(path.join(out, "result.json"), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(out, "changes.patch"), fullDiff(path.resolve(target)));
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case "build-pack": {
    // S06: build a candidate pack from public evidence. Model calls happen here (our side); the
    // free scan never reaches this path. --out is the only place files land.
    const from = flag("--from"), to = flag("--to"), out = flag("--out");
    const changelog = flag("--changelog");
    if (!from || !to || !out) {
      console.error("usage: shim build-pack <package> --from <ver> --to <ver> --out <dir> [--changelog <file>]");
      process.exit(1);
    }
    const { buildPack } = await import("./pack-builder/build.js");
    // The cross-pack negative control: every real pack fixture dir under test/fixtures/ EXCEPT the
    // one being generated (the pack must not fire on another pack's fixtures).
    const fixtureDirs = fixtureRoots(target).map((r) => path.resolve("test", "fixtures", r));
    const report = await buildPack({ package: target, from, to, outDir: path.resolve(out), changelog: changelog ? path.resolve(changelog) : undefined, fixtureDirs });
    console.log(JSON.stringify({ package: report.package, shipped: report.shipped, admitted: report.admitted, cost: report.cost, draftModel: report.draftModel, judgeModel: report.judgeModel }, null, 2));
    break;
  }
  case "score": {
    const rows = await scoreTargets(target, flag("--prs") ?? "data/prs.csv");
    for (const r of rows.slice(0, 20)) console.log(`${r.score}\t${r.repo}\t${r.scoreReasons.join("; ")}`);
    break;
  }
  case "discover": {
    const m = getMigration(migFlag());
    const candidates = await discover(Number(target) || 60, 16, m);
    console.log(JSON.stringify(candidates, null, 2));
    break;
  }
  case "pr": {
    if (target === "record") {
      const repo = rest[0], url = rest[1];
      if (!repo || !url) {
        console.error("usage: shim pr record <owner/repo> <pr-url>");
        process.exit(1);
      }
      console.log(JSON.stringify(prRecord({ repo, prUrl: url }), null, 2));
      break;
    }
    if (target === "status") {
      await prStatus(path.resolve("data", "prs.csv"), { write: rest.includes("--write") });
      break;
    }
    if (target !== "open") {
      console.log(USAGE);
      process.exit(1);
    }
    const draftDir = rest[0];
    const forkOwner = flag("--fork");
    if (!draftDir || !forkOwner) {
      console.error("usage: shim pr open <draft-dir> --fork <forkOwner> [--allow-drift]");
      process.exit(1);
    }
    const r = prOpen({ draftDir, forkOwner, allowDrift: rest.includes("--allow-drift") });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  default:
    console.log(USAGE);
    process.exit(1);
}

/**
 * The real pack fixture roots under test/fixtures/ (the v6-app + CRLF CI for ai, zod3-app, the
 * express4-app). The cross-pack negative control for build-pack: a generated pack must not fire on
 * any OTHER pack's fixtures, so when building a pack for `pkg` we pass every root except pkg's own.
 */
function fixtureRoots(excludePkg?: string): string[] {
  const roots = ["v6-app", "crlf-ci", "zod3-app", "express4-app"];
  const pkgRoots: Record<string, string[]> = { ai: ["v6-app", "crlf-ci"], zod: ["zod3-app"], express: ["express4-app"] };
  if (!excludePkg) return roots;
  return roots.filter((r) => !(pkgRoots[excludePkg] ?? []).includes(r));
}

/** The whole change, new files included, as a patch that `git apply` can replay on a fresh clone. */
function fullDiff(dir: string): string {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  git("add", "-A");
  const patch = git("diff", "--cached", "--binary");
  git("reset", "-q");
  return patch;
}
