import fs from "node:fs";
import path from "node:path";
import { run } from "./exec.js";

/**
 * Copy a prepared repo for a fixer candidate. Source files are real copies (the fixer edits them in
 * place); node_modules trees are hard-linked, since nothing writes into them unless a manifest changes,
 * and then the candidate drops them and reinstalls (see unshareNodeModules). A 1.8 GB monorepo costs a
 * few MB per candidate instead of 1.8 GB.
 */
export function copyRepo(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dst, name);
    const st = fs.lstatSync(from);
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
    else if (st.isDirectory() && name === "node_modules") run("cp", ["-al", from, to], ".", 30 * 60_000);
    else if (st.isDirectory()) copyRepo(from, to);
    else {
      fs.copyFileSync(from, to);
      fs.chmodSync(to, st.mode);
    }
  }
}

/** Replace hard-linked node_modules with nothing, so a reinstall can't write through to other copies. */
export function unshareNodeModules(dir: string) {
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      if (name === ".git" || !fs.lstatSync(p).isDirectory()) continue;
      if (name === "node_modules") fs.rmSync(p, { recursive: true, force: true });
      else walk(p);
    }
  };
  walk(dir);
}
