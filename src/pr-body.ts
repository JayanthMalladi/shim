import type { MigrationReport } from "./pipeline.js";
import type { Finding } from "./types.js";

const SEVERITY_LABEL = {
  break: "Fixed: would fail at runtime on v7",
  silent: "Fixed: same code, different behavior on v7",
  deprecated: "Fixed: deprecated in v7",
} as const;

const SOURCE_FILE = /\.(m|c)?[jt]sx?$/;
const MAX_LOCATIONS = 10;

/**
 * Short, specific, and honest about what was and wasn't checked. Maintainers skim.
 * `patch` is the change as a unified diff (any context size): it decides which findings the PR really fixed.
 * Without it, a finding counts as fixed if its file changed at all.
 */
export function prBody(r: MigrationReport, patch?: string): string {
  const changes = patch === undefined ? undefined : parsePatch(patch);
  const seen = new Set<string>();
  const unique = r.before.filter((f) => !seen.has(key(f)) && !!seen.add(key(f)));
  const changed = new Set(r.changedFiles);
  const touched = (f: Finding) => (changes ? touchesFinding(changes.get(f.file), f) : changed.has(f.file));
  const fixed = unique.filter((f) => f.fix !== "manual" && touched(f));
  // A deprecated alias that still works in v7 doesn't need a human; everything else Shim left alone does.
  const unfixed = unique.filter((f) => f.fix !== "manual" && !touched(f) && f.severity !== "deprecated");
  const forHuman = dedupe([...unique.filter((f) => f.fix === "manual"), ...unfixed, ...r.remaining]);
  const bySeverity = (s: Finding["severity"]) => fixed.filter((f) => f.severity === s);

  const sourceFiles = r.changedFiles.filter((f) => SOURCE_FILE.test(f));
  const fixedFiles = new Set(fixed.map((f) => f.file));
  const otherFiles = sourceFiles.filter((f) => !fixedFiles.has(f));
  const edits = r.agentRuns.length ? "codemod renames and fixer edits" : "codemod renames";
  const whatChanged = [
    ...(["break", "silent", "deprecated"] as const)
      .filter((s) => bySeverity(s).length)
      .map((s) => `**${SEVERITY_LABEL[s]}**\n${group(bySeverity(s))}`),
    ...(!sourceFiles.length ? ["No code changes needed: only dependency versions changed."] : []),
    ...(otherFiles.length
      ? [`${fixed.length ? "Other source files changed" : "Source files changed"} (${edits}): ${files(otherFiles)}.`]
      : []),
    ...(r.repairedChecks.length
      ? [`After the codemod, these checks failed; this PR fixes them: ${r.repairedChecks.map((g) => `\`${g}\``).join(", ")}.`]
      : []),
  ];

  const gates = Object.keys(r.baseline)
    .map((g) => `| ${g} | ${r.baseline[g] ? "pass" : "fail"} | ${r.after[g] ? "pass" : "fail"} |`)
    .join("\n");

  return [
    `## Upgrade to AI SDK 7`,
    [
      `This PR moves the project from AI SDK 6 to 7 and keeps its current behavior${forHuman.length ? ', except where noted under "Needs your eyes"' : ""}.`,
      ...explain(fixed),
    ].join("\n"),
    `### Versions\n${versionLines(r.versionChanges, patch)}`,
    ...(r.library ? ["This drops support for AI SDK 6, so users of this package will need AI SDK 7 too. It probably belongs in a new major version."] : []),
    `### What changed and why\n${whatChanged.join("\n\n")}`,
    ...(forHuman.length ? [`### Needs your eyes\nShim did not change these. Please check them before merging.\n${group(forHuman)}`] : []),
    `### How it was checked\n| Check | Before | After |\n|---|---|---|\n${gates}`,
    `Also ran \`npx @ai-sdk/codemod v7\` (official). Install ran with \`--ignore-scripts\`.${r.review?.approve ? " A second agent reviewed the full diff for behavior changes and unrelated edits." : ""}`,
    `### Rollback\nRevert this PR. No data or config migrations are involved.`,
    `---\nOpened by [Shim](https://github.com/JayanthMalladi/shim), which turns API breaking changes into tested PRs. Not useful? Close it and we won't open another on this repo.`,
  ].join("\n\n") + "\n";
}

const key = (f: Finding) => `${f.ruleId}:${f.file}:${f.line}`;
const dedupe = (fs: Finding[]) => {
  const seen = new Set<string>();
  return fs.filter((f) => !seen.has(key(f)) && !!seen.add(key(f)));
};

const files = (fs: string[]) =>
  fs.slice(0, MAX_LOCATIONS).map((f) => `\`${f}\``).join(", ") + (fs.length > MAX_LOCATIONS ? `, and ${fs.length - MAX_LOCATIONS} more` : "");

/** One bullet per distinct message, with every `file:line` it applies to. */
function group(fs: Finding[]): string {
  const byMessage = new Map<string, string[]>();
  for (const f of fs) byMessage.set(f.message, [...(byMessage.get(f.message) ?? []), `${f.file}:${f.line}`]);
  return [...byMessage].map(([message, at]) => `- ${files(at)}: ${message}`).join("\n");
}

/** An example for the silent changes this PR actually fixed; nothing when it fixed none of them. */
function explain(fixed: Finding[]): string[] {
  const rules = new Set(fixed.map((f) => f.ruleId));
  const multiStep = ["multi-step-result", "multi-step-end-event", "maybe-multi-step-result", "typed-multi-step-result"].some((r) => rules.has(r));
  return [
    ...(multiStep
      ? ["On a multi-step call, `result.usage` now counts every step instead of only the last one. Where your code relied on the v6 meaning, this PR reads the same value from `finalStep`."]
      : []),
    ...(rules.has("response-messages")
      ? ["`result.response.messages` now holds only the last step's messages; this PR uses `responseMessages` where the full history was meant."]
      : []),
  ];
}

// --- Versions -------------------------------------------------------------------------------

interface VersionChange {
  name: string;
  from: string;
  to: string;
  file?: string;
  field?: string;
}

/** "ai: ^6 -> ^7" or, from bumpAiSdk, "ai (packages/a/package.json, peerDependencies): ^6 -> ^7". */
function parseVersionChange(text: string): VersionChange | undefined {
  const m = text.match(/^(\S+?)(?: \(([^)]*)\))?: (.*) -> (.*)$/);
  if (!m) return undefined;
  const [file, field] = (m[2] ?? "").split(", ");
  return { name: m[1]!, from: m[3]!, to: m[4]!, file: field ? file : undefined, field };
}

function versionLines(raw: string[], patch?: string): string {
  const occurrences = patch === undefined ? [] : versionOccurrences(patch);
  const changes = raw.map((text) => {
    const p = parseVersionChange(text);
    if (!p || p.field) return p ?? text;
    // Older reports don't say where a bump happened; find it in the diff.
    const at = occurrences.findIndex((o) => o.name === p.name && o.from === p.from);
    const [hit] = at >= 0 ? occurrences.splice(at, 1) : [];
    return hit ? { ...p, file: hit.file, field: hit.field } : p;
  });
  const parsed = changes.filter((c): c is VersionChange => typeof c !== "string");
  const order = (c: VersionChange | string) => (typeof c === "string" ? c : `${c.name}|${c.file ?? ""}|${c.field ?? ""}`);
  const lines = [...changes].sort((a, b) => order(a).localeCompare(order(b))).map((c) => {
    if (typeof c === "string") return `- ${c}`;
    // Label a package that appears more than once, so the lines can be told apart.
    const same = parsed.filter((o) => o.name === c.name);
    const ambiguous = new Set(same.map((o) => `${o.file}|${o.field}|${o.from}|${o.to}`)).size > 1;
    const manyFiles = new Set(same.map((o) => o.file).filter(Boolean)).size > 1;
    const label = ambiguous ? [manyFiles ? c.file : undefined, c.field].filter(Boolean).join(", ") : "";
    return `- \`${c.name}\`${label ? ` (${label})` : ""}: ${c.from} → ${c.to}`;
  });
  return [...new Set(lines)].join("\n") || "- none";
}

/** Dependency lines removed from package.json files in the diff, with the field they sit in when the hunk shows it. */
function versionOccurrences(patch: string): Array<{ file: string; field?: string; name: string; from: string }> {
  const out: Array<{ file: string; field?: string; name: string; from: string }> = [];
  for (const [file, change] of parsePatch(patch)) {
    if (!/(^|\/)package\.json$/.test(file)) continue;
    let field: string | undefined;
    let hunk = -1;
    for (const l of change.lines) {
      if (l.hunk !== hunk) [hunk, field] = [l.hunk, undefined];
      const header = l.text.match(/"(dependencies|devDependencies|peerDependencies|optionalDependencies)"\s*:\s*\{/);
      if (header) field = header[1];
      const dep = l.kind === "-" ? l.text.match(/^\s*"([^"]+)":\s*"([^"]*)",?\s*$/) : null;
      if (dep) out.push({ file, field, name: dep[1]!, from: dep[2]! });
    }
  }
  return out;
}

// --- Which findings did the patch fix? ------------------------------------------------------

interface FileChange {
  /** Old-side line numbers the patch removes or rewrites. */
  removed: Set<number>;
  /** Added lines, with the old-side line they come after. */
  added: Array<{ after: number; text: string }>;
  lines: Array<{ kind: " " | "-" | "+"; text: string; hunk: number }>;
}

/** Old-side line numbers per changed file, from a unified diff of any context size. */
export function parsePatch(patch: string): Map<string, FileChange> {
  const files = new Map<string, FileChange>();
  let current: FileChange | undefined;
  let oldName = "";
  let old = 0;
  let [oldLeft, newLeft, hunk] = [0, 0, 0];
  for (const line of patch.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      const kind = line[0] as " " | "-" | "+" | undefined;
      if (kind === "-" || kind === "+" || kind === " ") {
        if (kind !== "+") oldLeft--;
        if (kind !== "-") newLeft--;
        current?.lines.push({ kind, text: line.slice(1), hunk });
        if (kind === "-") current?.removed.add(old);
        if (kind === "+") current?.added.push({ after: old - 1, text: line.slice(1) });
        if (kind !== "+") old++;
        continue;
      }
      if (line.startsWith("\\")) continue;
    }
    if (line.startsWith("--- ")) oldName = line.slice(4).replace(/^a\//, "");
    else if (line.startsWith("+++ ")) {
      const name = line.slice(4) === "/dev/null" ? oldName : line.slice(4).replace(/^b\//, "");
      current = files.get(name) ?? { removed: new Set(), added: [], lines: [] };
      files.set(name, current);
    } else {
      const h = line.match(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
      if (!h) continue;
      oldLeft = Number(h[2] ?? 1);
      newLeft = Number(h[3] ?? 1);
      // A hunk with no old lines inserts after line `h[1]`.
      old = oldLeft === 0 ? Number(h[1]) + 1 : Number(h[1]);
      hunk++;
    }
  }
  return files;
}

/**
 * The fix edits the finding's own line (a read rewritten to `finalStep`), or, for a system message, adds
 * `allowSystemInMessages`/`instructions` somewhere in the same call. Anything else, such as a change a few
 * lines away, is not a fix for this finding.
 */
function touchesFinding(change: FileChange | undefined, f: Finding): boolean {
  if (!change) return false;
  const near = (n: number, before: number, after: number) => n >= f.line - before && n <= f.line + after;
  if ([...change.removed].some((n) => near(n, 1, 1))) return true;
  return /system-in-messages$/.test(f.ruleId) && change.added.some((a) => near(a.after, 1, 25) && /allowSystemInMessages|instructions/.test(a.text));
}
