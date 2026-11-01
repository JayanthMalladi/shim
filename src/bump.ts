import fs from "node:fs";
import { run } from "./exec.js";
import path from "node:path";
import { findPackageJsons } from "./scan.js";

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
 * Bump `ai` to ^7 and every `@ai-sdk/*` package to its latest major, in every package.json in the repo.
 * That includes ones that don't depend on `ai`, like a monorepo root with only `@ai-sdk/anthropic` in
 * devDependencies: left on the old major it pulls a second @ai-sdk/provider and breaks the types.
 * Edits the text in place so the file's own formatting survives: a re-serialized package.json is diff
 * noise maintainers reject. Each change reads "name (path, field): from -> to".
 */
export function bumpAiSdk(root: string, latest: (pkg: string, cwd: string) => string | undefined = latestMajor): string[] {
  const changes: string[] = [];
  for (const file of findPackageJsons(root)) {
    let text = fs.readFileSync(file, "utf8");
    const pkg = JSON.parse(text);
    for (const field of DEP_FIELDS) {
      for (const [name, range] of Object.entries<string>(pkg[field] ?? {})) {
        if (name !== "ai" && !name.startsWith("@ai-sdk/")) continue;
        // workspace:, catalog:, npm:, file: and the like aren't ranges we can rewrite.
        if (range.includes(":")) continue;
        const next = name === "ai" ? "^7.0.0" : latest(name, root);
        // Never touch a range that already allows the target major: rewriting ^7.0.11 to ^7.0.0
        // lowers the floor, and narrowing >=6 to ^7 drops support for nothing.
        if (!next || allowsMajor(range, Number(next.slice(1).split(".")[0]))) continue;
        const pattern = new RegExp(`("${escape(name)}"\\s*:\\s*)"${escape(range)}"`);
        if (!pattern.test(text)) continue;
        text = text.replace(pattern, `$1"${next}"`);
        changes.push(`${name} (${path.relative(root, file).split(path.sep).join("/")}, ${field}): ${range} -> ${next}`);
      }
    }
    fs.writeFileSync(file, text);
  }
  return changes;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True if the range's own text already admits the given major (^7.x, >=6, 6 || 7, *). */
export function allowsMajor(range: string, major: number): boolean {
  return range.split("||").some((part) => {
    const p = part.trim();
    if (p === "*" || p === "latest" || p === "") return true;
    const m = p.match(/^(>=|>)?\s*[\^~=v]*\s*(\d+)/);
    if (!m) return false;
    const n = Number(m[2]);
    if (!m[1]) return n === major;
    const upper = Number(p.match(/<\s*(\d+)/)?.[1] ?? Infinity);
    return n <= major && major < upper;
  });
}
