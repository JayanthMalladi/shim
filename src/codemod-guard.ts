import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Project } from "ts-morph";
import type { Finding } from "./types.js";

const SOURCE = /\.(m|c)?[jt]sx?$/;

/**
 * The official codemod sometimes renames the repo's own exports (it renames every identifier that
 * contains an old SDK name). That breaks the package's users, and the repo's checks can't see it.
 * Compare each touched file's exports before and after, and flag any that disappeared.
 */
export function codemodExportFindings(dir: string): Finding[] {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  // Fixer candidates carry a snapshot commit on top of the original; compare against the original.
  const base = git("log", "-1", "--format=%s").trim() === "shim: before fixer" ? "HEAD~1" : "HEAD";
  const files = git("diff", "--name-only", base).split("\n").filter((f) => SOURCE.test(f) && !f.includes("node_modules"));
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true } });
  const findings: Finding[] = [];
  for (const file of files) {
    let before: string;
    try {
      before = git("show", `${base}:${file}`);
    } catch {
      continue; // new file
    }
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) continue;
    const after = fs.readFileSync(full, "utf8");
    // Re-exports (`export { x } from "./x"`) can't be resolved in memory, so read their names from syntax.
    const names = (text: string, name: string) => {
      const sf = project.createSourceFile(name, text, { overwrite: true });
      const set = new Set(sf.getExportedDeclarations().keys());
      for (const d of sf.getExportDeclarations()) for (const n of d.getNamedExports()) set.add(n.getAliasNode()?.getText() ?? n.getName());
      return set;
    };
    const old = names(before, `/before/${file}`);
    const now = names(after, `/after/${file}`);
    const removed = [...old].filter((n) => !now.has(n));
    const added = [...now].filter((n) => !old.has(n));
    for (const name of removed) {
      findings.push({
        ruleId: "codemod-renamed-export",
        severity: "break",
        fix: "agent",
        file,
        line: 1,
        snippet: `export ${name}`,
        message:
          `The codemod removed or renamed this file's own export \`${name}\`${added.length ? ` (now ${added.map((a) => `\`${a}\``).join(", ")})` : ""}. ` +
          "That breaks the package's users. Restore the original export name and keep only the SDK import change.",
      });
    }
  }
  return findings;
}
