#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { discover } from "./discover.js";
import { migrate } from "./pipeline.js";
import { scan, scanAndFix } from "./scan.js";
import { triage } from "./triage.js";

const USAGE = `shim <command>

  discover [days]          Find npm packages on ai@6 published in the last N days (default 60)
  triage <candidates.json> [--work <dir>]
                           Shallow-clone and scan each candidate (read-only)
  scan <dir>               List AI SDK 6 -> 7 findings (no changes)
  fix <dir>                Apply Shim's deterministic, behavior-preserving fixes
  migrate <dir> [--agent] [--out <dir>] [--repo <owner/name>]
                           Full pipeline: baseline gates, bump, codemod, fixes,
                           optional fixer agent, gates again, report + PR body`;

const [cmd, target, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};

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
    });
    console.log(JSON.stringify({ verdict: report.verdict, reason: report.reason, autoFixed: report.autoFixed, remaining: report.remaining.length }, null, 2));
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
  default:
    console.log(USAGE);
    process.exit(1);
}
