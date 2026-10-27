import type { MigrationReport } from "./pipeline.js";
import type { Finding } from "./types.js";

const SEVERITY_LABEL = { break: "Would break", silent: "Silent behavior change", deprecated: "Deprecated" } as const;

const list = (fs: Finding[]) => fs.map((f) => `- \`${f.file}:${f.line}\` ${f.message}`).join("\n");

/** Short, specific, and honest about what was and wasn't checked. Maintainers skim. */
export function prBody(r: MigrationReport): string {
  const fixed = r.before.filter((f) => f.fix !== "manual");
  const forHuman = [...r.before.filter((f) => f.fix === "manual"), ...r.remaining];
  const bySeverity = (s: Finding["severity"]) => fixed.filter((f) => f.severity === s);
  const gates = Object.keys(r.baseline)
    .map((g) => `| ${g} | ${r.baseline[g] ? "pass" : "fail"} | ${r.after[g] ? "pass" : "fail"} |`)
    .join("\n");

  return `## Upgrade to AI SDK 7

This PR moves the project from AI SDK 6 to 7 and keeps its current behavior${forHuman.length ? ", except where noted under \"Needs your eyes\"" : ""}.

AI SDK 7 changes some values without a type error, so the official codemod alone is not enough here.
For example, \`result.usage\` on a multi-step call now counts every step instead of only the last one.
Where your code relied on the v6 meaning, this PR reads the same value from \`finalStep\`.

### Versions
${r.versionChanges.map((c) => `- ${c}`).join("\n") || "- none"}

### What changed and why
${(["break", "silent", "deprecated"] as const)
  .filter((s) => bySeverity(s).length)
  .map((s) => `**${SEVERITY_LABEL[s]}**\n${list(bySeverity(s))}`)
  .join("\n\n") || "Only the codemod's renames were needed."}
${forHuman.length ? `\n### Needs your eyes\nShim did not change these. Please check them before merging.\n${list(forHuman)}\n` : ""}
### How it was checked
| Check | Before | After |
|---|---|---|
${gates}

Also ran \`npx @ai-sdk/codemod v7\` (official). Install ran with \`--ignore-scripts\`.

### Rollback
Revert this PR. No data or config migrations are involved.

---
Opened by [Shim](https://github.com/JayanthMalladi/shim), which turns API breaking changes into tested PRs. Not useful? Close it and we won't open another on this repo.
`;
}
