import fs from "node:fs";
import path from "node:path";
import { allowsMajor } from "./bump.js";
import { findPackageJsons, readJson } from "./scan.js";

/** Before install: a package that lists zod as a peer is a library that needs dual v3/v4 support. */
export function zodPeerDependencySkip(root: string): string | undefined {
  for (const file of findPackageJsons(root)) {
    if (typeof readJson(file)?.peerDependencies?.zod === "string") {
      return "zod is a peerDependency: library needs dual v3/v4 support";
    }
  }
  return undefined;
}

/**
 * After install: the first top-level package in `dirs`' node_modules (including @scope/*) whose
 * peer range for zod excludes 4. Bumping would leave it running against a zod it doesn't support.
 */
export function installedPeerSkip(dirs: string[]): string | undefined {
  for (const dir of dirs) {
    const nm = path.join(dir, "node_modules");
    if (!fs.existsSync(nm)) continue;
    for (const name of fs.readdirSync(nm).sort()) {
      if (name.startsWith(".")) continue;
      const pkgDirs = name.startsWith("@")
        ? fs.readdirSync(path.join(nm, name)).sort().map((n) => path.join(nm, name, n))
        : [path.join(nm, name)];
      for (const d of pkgDirs) {
        const pkg = readJson(path.join(d, "package.json"));
        const range = pkg?.peerDependencies?.zod;
        if (pkg?.name !== "zod" && typeof range === "string" && !allowsMajor(range, 4)) {
          return `${pkg.name}@${pkg.version} requires zod 3 (peer ${range})`;
        }
      }
    }
  }
  return undefined;
}
