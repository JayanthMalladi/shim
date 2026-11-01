import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { run } from "../src/exec.js";
import { runReviewer } from "../src/agent.js";

/**
 * The reviewer diff-restore guard in agent.ts snapshots the tree with `git write-tree` before
 * the agent runs, and restores it with `git read-tree <snapshot> + git reset -q` if the tree
 * differs afterwards. This keeps the fixer's uncommitted edits (the candidate diff) intact
 * while removing anything the reviewer added.
 *
 * The second test exercises `runReviewer` directly with `SHIM_AGENT_BACKEND=dsh` and a fake
 * `dsh` on PATH that edits a file: it asserts the pre-review diff survives and the result is
 * `approve: false` (discarded).
 */
function setupRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-reviewer-guard-"));
  run("git", ["init", "-q"], dir);
  run("git", ["config", "user.name", "test"], dir);
  run("git", ["config", "user.email", "test@test"], dir);
  // Stable line endings on Windows: git's checkout would otherwise round-trip the test's \n
  // working files to \r\n, so the restored file contents would not byte-equal the pre-review ones.
  run("git", ["config", "core.autocrlf", "false"], dir);
  fs.writeFileSync(path.join(dir, "src.ts"), "const x = 1;\n");
  run("git", ["add", "."], dir);
  run("git", ["commit", "-q", "-m", "init"], dir);
  return dir;
}

describe("reviewer diff-restore guard (git snapshot/restore mechanics)", () => {
  let dir: string;
  beforeEach(() => { dir = setupRepo(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("read-tree + clean -fd + checkout -- . + reset -q restores a dirty tree to the snapshot state", () => {
    // Simulate the fixer's uncommitted work: a modified tracked file + a new untracked file.
    fs.writeFileSync(path.join(dir, "src.ts"), "const x = 2;\n");
    fs.writeFileSync(path.join(dir, "new-file.ts"), "const y = 1;\n");
    // Snapshot: stage everything (so the write-tree includes the fixer's new file) then write-tree.
    run("git", ["add", "-A"], dir);
    const treeBefore = run("git", ["write-tree"], dir).output.trim();
    expect(treeBefore).toMatch(/^[0-9a-f]{40}$/);
    // Simulate the reviewer making further edits: overwrite the tracked file + add its own file.
    fs.writeFileSync(path.join(dir, "src.ts"), "const x = 99;\n");
    fs.writeFileSync(path.join(dir, "rogue.ts"), "const z = 1;\n");
    // Restore to the pre-review snapshot: read-tree restores new-file.ts from the snapshot into the
    // index; clean -fd removes untracked files that are NOT in the snapshot (rogue.ts, but keeps
    // new-file.ts because it is in the snapshot's tree); checkout -- . rewrites tracked files from the
    // index; reset -q un-stages everything so the tree matches the pre-review diff/status exactly.
    run("git", ["read-tree", treeBefore], dir);
    run("git", ["clean", "-q", "-fd"], dir);
    run("git", ["checkout", "-q", "--", "."], dir);
    run("git", ["reset", "-q"], dir);
    // The fixer's edits survive; the reviewer's additions are gone.
    expect(fs.readFileSync(path.join(dir, "src.ts"), "utf8")).toBe("const x = 2;\n");
    expect(fs.readFileSync(path.join(dir, "new-file.ts"), "utf8")).toBe("const y = 1;\n");
    expect(fs.existsSync(path.join(dir, "rogue.ts"))).toBe(false);
    // The tree is unstaged and matches the pre-review state exactly.
    const diffAfter = run("git", ["diff", "HEAD", "--binary"], dir).output;
    const statusAfter = run("git", ["status", "--porcelain"], dir).output;
    expect(diffAfter).toContain("const x = 2");
    expect(statusAfter).toContain("src.ts");
    expect(statusAfter).toContain("new-file.ts");
  });

  it("the restore is idempotent: running it twice leaves the tree at the snapshot state", () => {
    fs.writeFileSync(path.join(dir, "src.ts"), "const x = 2;\n");
    fs.writeFileSync(path.join(dir, "new-file.ts"), "const y = 1;\n");
    run("git", ["add", "-A"], dir);
    const treeBefore = run("git", ["write-tree"], dir).output.trim();
    for (let i = 0; i < 2; i++) {
      run("git", ["read-tree", treeBefore], dir);
      run("git", ["clean", "-q", "-fd"], dir);
      run("git", ["checkout", "-q", "--", "."], dir);
      run("git", ["reset", "-q"], dir);
    }
    expect(fs.readFileSync(path.join(dir, "src.ts"), "utf8")).toBe("const x = 2;\n");
    expect(fs.existsSync(path.join(dir, "new-file.ts"))).toBe(true);
  });
});

describe("runReviewer discards its verdict and restores the tree when the reviewer edits files", () => {
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};
  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-fake-dsh-"));

  beforeEach(() => {
    dir = setupRepo();
    // Simulate the fixer's uncommitted work (the candidate diff the judge will score).
    fs.writeFileSync(path.join(dir, "src.ts"), "const x = 2;\n");
    fs.writeFileSync(path.join(dir, "new-file.ts"), "const y = 1;\n");
    // Fake `dsh`: edit a file (simulating a reviewer that slips past the allowlist), then emit
    // a valid verdict. dsh resolves to a .cmd batch file on Windows (cross-spawn runs it directly,
    // no cmd /c wrapper) and a shell script on POSIX; the body writes hacked.txt in the cwd and
    // prints the verdict JSON to stdout (runDsh takes the combined output as the agent's text).
    const body = [
      "(type \"\" 2>nul & if not exist \"hacked.txt\" (echo const hacked = 1 > \"hacked.txt\"))",
      'echo {"approve": true, "issues": []}',
    ];
    const fake = path.join(fakeDir, "dsh");
    if (process.platform === "win32") {
      fs.writeFileSync(fake + ".cmd", `@ECHO OFF\r\n${body.join("\r\n")}\r\n`);
    } else {
      const sh = ["[ -f hacked.txt ] || echo 'const hacked = 1' > hacked.txt", "echo '{\"approve\": true, \"issues\": []}'"];
      fs.writeFileSync(fake, `#!/bin/sh\n${sh.join("\n")}\n`, { mode: 0o755 });
    }
    // Put the fake dsh on PATH and select the dsh backend.
    for (const k of ["PATH", "SHIM_AGENT_BACKEND", "SHIM_SANDBOX", "SHIM_REVIEWER_MODEL"] as const)
      savedEnv[k] = process.env[k];
    process.env.PATH = `${fakeDir}${path.delimiter}${process.env.PATH ?? ""}`;
    process.env.SHIM_AGENT_BACKEND = "dsh";
    process.env.SHIM_SANDBOX = "1";
    process.env.SHIM_REVIEWER_MODEL = "claude-opus-4-5";
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fakeDir, { recursive: true, force: true });
  });

  it("pre-review diff survives and the verdict is discarded (approve: false)", async () => {
    const diffBefore = run("git", ["diff", "HEAD", "--binary"], dir).output;
    const statusBefore = run("git", ["status", "--porcelain"], dir).output;
    expect(diffBefore).toContain("const x = 2"); // the fixer's edit
    expect(statusBefore).toContain("new-file.ts"); // the fixer's new file

    const review = await runReviewer(dir);

    // The reviewer's verdict is discarded because it modified the tree.
    expect(review.approve).toBe(false);
    expect(review.issues[0]).toBe("reviewer modified files; result discarded");
    // The fixer's pre-review diff and new file survive the restore.
    const diffAfter = run("git", ["diff", "HEAD", "--binary"], dir).output;
    const statusAfter = run("git", ["status", "--porcelain"], dir).output;
    expect(diffAfter).toBe(diffBefore);
    expect(statusAfter).toBe(statusBefore);
    expect(fs.readFileSync(path.join(dir, "src.ts"), "utf8")).toBe("const x = 2;\n");
    expect(fs.existsSync(path.join(dir, "new-file.ts"))).toBe(true);
    // The reviewer's own addition is gone.
    expect(fs.existsSync(path.join(dir, "hacked.txt"))).toBe(false);
  });
});
