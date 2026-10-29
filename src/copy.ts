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

/**
 * Recursive delete that retries with backoff: on Windows a lingering handle (a gate's node
 * process, pnpm's cache writer) makes rmdir throw EBUSY even after the process that held it is
 * gone. Used wherever the pipeline removes trees that candidate copies share hard links with.
 */
export async function rmTree(p: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    if (!fs.existsSync(p)) return;
    try {
      fs.rmSync(p, { recursive: true, force: true });
      return;
    } catch {
      if (attempt >= 40) throw new Error(`could not remove ${p} after 40 attempts (locked?)`);
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

/** Replace hard-linked node_modules with nothing, so a reinstall can't write through to other copies. */
export async function unshareNodeModules(dir: string): Promise<void> {
  const walk = async (d: string) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      if (name === ".git" || !fs.lstatSync(p).isDirectory()) continue;
      if (name === "node_modules") await rmTree(p);
      else await walk(p);
    }
  };
  await walk(dir);
}
