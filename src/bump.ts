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

/** Bump `ai` to ^7 and every `@ai-sdk/*` package to its latest major, in every package.json that uses ai. */
export function bumpAiSdk(root: string): string[] {
  const changes: string[] = [];
  for (const { file } of findAiPackages(root)) {
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const field of DEP_FIELDS) {
      const deps = pkg[field];
      if (!deps) continue;
      for (const name of Object.keys(deps)) {
        if (name !== "ai" && !name.startsWith("@ai-sdk/")) continue;
        if (String(deps[name]).startsWith("workspace:")) continue;
        const next = name === "ai" ? "^7.0.0" : latestMajor(name, root);
        if (next && next !== deps[name]) {
          changes.push(`${name}: ${deps[name]} -> ${next}`);
          deps[name] = next;
        }
      }
    }
    const indent = fs.readFileSync(file, "utf8").match(/^\{\n(\s+)/)?.[1] ?? "  ";
    fs.writeFileSync(file, JSON.stringify(pkg, null, indent) + "\n");
  }
  return changes;
}
