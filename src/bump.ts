import fs from "node:fs";
import { run } from "./exec.js";
import { findAiPackages } from "./scan.js";

const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies"] as const;
const latestCache = new Map<string, string>();

function latestMajor(pkg: string, cwd: string): string | undefined {
  if (!latestCache.has(pkg)) {
    const r = run("npm", ["view", pkg, "version"], cwd, 60_000);
    if (r.ok) latestCache.set(pkg, r.output.trim().split("\n").pop()!.trim());
  }
  const v = latestCache.get(pkg);
  return v ? `^${v.split(".")[0]}.0.0` : undefined;
}

/**
 * Bump `ai` to ^7 and every `@ai-sdk/*` package to its latest major, in every package.json
 * that uses ai. Edits the text in place so the file's own formatting survives: a
 * re-serialized package.json is diff noise maintainers reject.
 */
export function bumpAiSdk(root: string): string[] {
  const changes: string[] = [];
  for (const { file } of findAiPackages(root)) {
    let text = fs.readFileSync(file, "utf8");
    const pkg = JSON.parse(text);
    for (const field of DEP_FIELDS) {
      for (const [name, range] of Object.entries<string>(pkg[field] ?? {})) {
        if (name !== "ai" && !name.startsWith("@ai-sdk/")) continue;
        if (range.startsWith("workspace:")) continue;
        const next = name === "ai" ? "^7.0.0" : latestMajor(name, root);
        if (!next || next === range) continue;
        const pattern = new RegExp(`("${escape(name)}"\\s*:\\s*)"${escape(range)}"`);
        if (!pattern.test(text)) continue;
        text = text.replace(pattern, `$1"${next}"`);
        changes.push(`${name}: ${range} -> ${next}`);
      }
    }
    fs.writeFileSync(file, text);
  }
  return changes;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
