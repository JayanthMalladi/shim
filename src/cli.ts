#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { discover } from "./discover.js";
import { runJudge } from "./agent.js";
import { DEFAULT_ARCH, type Architecture } from "./arch.js";
import { finish, migrate, prepare } from "./pipeline.js";
import { execFileSync } from "node:child_process";
import { scan, scanAndFix } from "./scan.js";
import { prOpen, prRecord } from "./pr.js";
import { writeStats } from "./stats.js";
import { triage } from "./triage.js";
import { prStatus } from "./pr-status.js";

const USAGE = `shim <command>

  discover [days]          Find npm packages on ai@6 published in the last N days (default 60)
  triage <candidates.json> [--work <dir>]
                           Shallow-clone and scan each candidate (read-only)
  scan <dir>               List AI SDK 6 -> 7 findings (no changes)
  fix <dir>                Apply Shim's deterministic, behavior-preserving fixes
  migrate <dir> [--agent] [--out <dir>] [--repo <owner/name>] [--arch <arch.json>]
                           Full pipeline: baseline gates, bump, codemod, fixes,
                           optional fixer agent, gates again, report + PR body
  prepare <dir> --out <dir> [--repo <owner/name>]
                           Everything before the fix stage; writes prepared.json
  finish <dir> --prep <prepared.json> --out <dir> [--arch <arch.json>] [--judge]
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
                           (the site's live numbers); commit it to redeploy`;

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
    const { result } = scan(target);
    for (const f of result.findings) console.log(`${f.file}:${f.line}  ${f.severity}/${f.fix}  [${f.ruleId}]  ${f.message}`);
    console.log(`\n${result.findings.length} findings in ${result.filesScanned} files`);
    break;
  }
  case "fix": {
    const { result, applied } = await scanAndFix(target);
    console.log(`${applied} auto-fixes applied; ${result.findings.filter((f) => f.fix !== "auto").length} findings need the agent or a human`);
    break;
  }
  case "migrate": {
    const report = await migrate(path.resolve(target), flag("--repo") ?? path.basename(target), {
      agent: rest.includes("--agent"),
      outDir: path.resolve(flag("--out") ?? path.join(target, "..", `${path.basename(target)}.shim`)),
      arch: loadArch(),
    });
    console.log(JSON.stringify({ verdict: report.verdict, reason: report.reason, autoFixed: report.autoFixed, remaining: report.remaining.length }, null, 2));
    break;
  }
  case "prepare": {
    const out = path.resolve(flag("--out") ?? `${target}.prep`);
    const p = await prepare(path.resolve(target), flag("--repo") ?? path.basename(target));
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "prepared.json"), JSON.stringify(p, null, 2));
    console.log(JSON.stringify("skip" in p ? { skip: p.skip } : summarize(p.prepared), null, 2));
    break;
  }
  case "finish": {
    const prep = JSON.parse(fs.readFileSync(flag("--prep")!, "utf8")).prepared;
    const out = path.resolve(flag("--out")!);
    const report = await finish(path.resolve(target), prep, { agent: true, outDir: out, arch: loadArch() });
    let judge;
    if (rest.includes("--judge") && report.verdict === "open-pr") {
      const j = await runJudge(path.resolve(target));
      judge = { approve: j.approve, issues: j.issues, cost: j.cost };
    }
    const result = { repo: report.repo, arch: report.arch, verdict: report.verdict, reason: report.reason.slice(0, 600), judge, cost: report.cost, fixMs: report.fixMs, candidates: report.candidates, diffStat: report.diffStat.split("\n").pop() };
    fs.writeFileSync(path.join(out, "result.json"), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(out, "changes.patch"), fullDiff(path.resolve(target)));
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case "triage": {
    const rows = triage(JSON.parse(fs.readFileSync(target, "utf8")), path.resolve(flag("--work") ?? "work"));
    console.log(JSON.stringify(rows, null, 2));
    break;
  }
  case "discover": {
    const candidates = await discover(Number(target) || 60);
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

/** The whole change, new files included, as a patch that `git apply` can replay on a fresh clone. */
function fullDiff(dir: string): string {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  git("add", "-A");
  const patch = git("diff", "--cached", "--binary");
  git("reset", "-q");
  return patch;
}
