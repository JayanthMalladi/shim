import fs from "node:fs";
import path from "node:path";
import { run } from "./exec.js";
import type { Candidate } from "./discover.js";
import { findAiPackages, scan } from "./scan.js";

export interface TriageRow extends Candidate {
  break: number;
  silent: number;
  deprecated: number;
  aiPackages: number;
  error?: string;
}

/**
 * Shallow-clone each candidate and scan it. Read-only: nothing from the repo is
 * installed or executed. Rows with silent findings are where Shim beats the codemod.
 */
export function triage(candidates: Candidate[], workDir: string): TriageRow[] {
  fs.mkdirSync(workDir, { recursive: true });
  const rows: TriageRow[] = [];
  for (const c of candidates) {
    const dir = path.join(workDir, c.repo.replace("/", "__"));
    const row: TriageRow = { ...c, break: 0, silent: 0, deprecated: 0, aiPackages: 0 };
    try {
      if (!fs.existsSync(dir)) {
        const clone = run("git", ["clone", "--depth", "1", "--quiet", `https://github.com/${c.repo}`, dir], workDir, 5 * 60_000);
        if (!clone.ok) throw new Error(`clone failed: ${clone.output.trim().split("\n").pop()}`);
      }
      const { findings } = scan(dir).result;
      for (const f of findings) row[f.severity]++;
      row.aiPackages = findAiPackages(dir).length;
    } catch (e) {
      row.error = (e as Error).message.slice(0, 200);
    }
    console.error(`[triage] ${c.repo}: ${row.error ?? `${row.break} break, ${row.silent} silent, ${row.deprecated} deprecated`}`);
    rows.push(row);
  }
  return rows.sort((a, b) => b.silent + b.break - (a.silent + a.break));
}
