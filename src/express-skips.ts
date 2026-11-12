import fs from "node:fs";
import path from "node:path";
import { allowsMajor } from "./bump.js";
import { findPackageJsons, readJson } from "./scan.js";

/**
 * Before install: a package that lists express as a peer is a middleware/middleware library that
 * needs dual v4/v5 support (it exposes an express version to its users). Bumping would break its
 * users, not just its code. Same shape as zodPeerDependencySkip.
 */
export function expressPeerDependencySkip(root: string): string | undefined {
  for (const file of findPackageJsons(root)) {
    if (typeof readJson(file)?.peerDependencies?.express === "string") {
      return "express is a peerDependency: library needs dual v4/v5 support";
    }
  }
  return undefined;
}

/**
 * After install: the first top-level package in `dirs`' node_modules (including @scope/*) whose
 * peer range for express excludes 5. Bumping would leave it running against an express it doesn't
 * support. Mirrors installedPeerSkip (the zod one).
 */
export function installedExpressPeerSkip(dirs: string[]): string | undefined {
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
        const range = pkg?.peerDependencies?.express;
        if (pkg?.name !== "express" && typeof range === "string" && !allowsMajor(range, 5)) {
          return `${pkg.name}@${pkg.version} requires express 4 (peer ${range})`;
        }
      }
    }
  }
  return undefined;
}
