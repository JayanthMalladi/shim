import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { run } from "../src/exec.js";
import { runReviewer } from "../src/agent.js";

/**
 * The reviewer diff-restore guard in agent.ts snapshots the tree with `git add -A` + `git
 * write-tree` + `git reset -q` before the agent runs, and restores it with `git read-tree
 * <snapshot>` + `git checkout-index -a -f` + `git clean -fd` + `git reset -q` if the tree
 * differs afterwards. This keeps the fixer's uncommitted edits (the candidate diff) intact
 * while removing anything the reviewer added, and — because the snapshot ends with `reset -q`
 * — the pre- and post-review `git status --porcelain` readings are taken in the same staging
 * state, so a read-only reviewer (no tree change) is not falsely discarded.
 *
 * The runReviewer tests exercise the real guard with `SHIM_AGENT_BACKEND=dsh` and a fake `dsh`
 * on PATH: one fake edits a file (verdict discarded, pre-review diff survives), one makes no
 * edits (verdict kept, and the fake saw a non-empty `git diff` — proof the un-staged tree is
 * what the reviewer reads).
 */
function setupRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-reviewer-guard-"));
  run("git", ["init", "-q"], dir);
  run("git", ["config", "user.name", "test"], dir);
  run("git", ["config", "user.email", "test@test"], dir);
  // Stable line endings on Windows: git's checkout would otherwise round-trip the test's \n
  // working files to \r\n, so the restored file contents would not byte-equal the pre-review ones.
  run("git", ["config", "core.autocrlf", "false"], dir);
  fs.writeFileSync(path.join(dir, "a.ts"), "const a = 1;\n");
  run("git", ["add", "."], dir);
  run("git", ["commit", "-q", "-m", "init"], dir);
  return dir;
}

describe("reviewer diff-restore guard (git snapshot/restore mechanics)", () => {
  let dir: string;
  beforeEach(() => { dir = setupRepo(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("snapshot (add -A + write-tree + reset -q) + restore (read-tree + checkout-index + clean + reset) keeps the fixer's work", () => {
    // Simulate the fixer's uncommitted work: a modified tracked file + a new untracked file.
    fs.writeFileSync(path.join(dir, "a.ts"), "const a = 2;\n");
    fs.writeFileSync(path.join(dir, "b.ts"), "const b = 1;\n");
    // Snapshot exactly as agent.ts does: stage, write-tree, then un-stage.
    run("git", ["add", "-A"], dir);
    const snap = run("git", ["write-tree"], dir).output.trim();
    run("git", ["reset", "-q"], dir);
    expect(snap).toMatch(/^[0-9a-f]{40}$/);
    // After the snapshot the tree is back to the un-staged state the fixer left it in.
    expect(run("git", ["status", "--porcelain"], dir).output).toContain("a.ts");
    // Simulate the reviewer making further edits: overwrite the tracked file + add its own file.
    fs.writeFileSync(path.join(dir, "a.ts"), "const a = 99;\n");
    fs.writeFileSync(path.join(dir, "c.ts"), "const c = 1;\n");
    // Restore to the pre-review snapshot, exactly as agent.ts does.
    run("git", ["read-tree", snap], dir);
    run("git", ["checkout-index", "-a", "-f"], dir);
    run("git", ["clean", "-q", "-fd"], dir);
    run("git", ["reset", "-q"], dir);
    // The fixer's edits survive; the reviewer's addition is gone; the tree is unstaged.
    expect(fs.readFileSync(path.join(dir, "a.ts"), "utf8")).toBe("const a = 2;\n");
    expect(fs.readFileSync(path.join(dir, "b.ts"), "utf8")).toBe("const b = 1;\n");
    expect(fs.existsSync(path.join(dir, "c.ts"))).toBe(false);
    const statusAfter = run("git", ["status", "--porcelain"], dir).output;
    expect(statusAfter).toContain("a.ts");
    expect(statusAfter).toContain("b.ts");
  });

  it("the restore is idempotent: running it twice leaves the tree at the snapshot state", () => {
    fs.writeFileSync(path.join(dir, "a.ts"), "const a = 2;\n");
    fs.writeFileSync(path.join(dir, "b.ts"), "const b = 1;\n");
    run("git", ["add", "-A"], dir);
    const snap = run("git", ["write-tree"], dir).output.trim();
    run("git", ["reset", "-q"], dir);
    for (let i = 0; i < 2; i++) {
      run("git", ["read-tree", snap], dir);
      run("git", ["checkout-index", "-a", "-f"], dir);
      run("git", ["clean", "-q", "-fd"], dir);
      run("git", ["reset", "-q"], dir);
    }
    expect(fs.readFileSync(path.join(dir, "a.ts"), "utf8")).toBe("const a = 2;\n");
    expect(fs.existsSync(path.join(dir, "b.ts"))).toBe(true);
  });
});

describe("runReviewer guard (fake dsh backend, real diff-restore path)", () => {
  let dir: string;
  let fakeDir: string;
  const savedEnv: Record<string, string | undefined> = {};
  /** Write the fake `dsh` script: `edit` adds a file to the tree; `recordDiff` dumps the length
   * of `git diff` it saw to a file the test can read. On Windows `dsh` resolves to a .cmd batch
   * file (cross-spawn runs it directly, no cmd /c wrapper); on POSIX a shell script. The body
   * prints the verdict JSON to stdout (runDsh takes the combined output as the agent's text). */
  /** Write the fake `dsh` script: `edit=true` also creates `c.ts` in the repo dir (the reviewer's
   * "rogue" edit). The script records the count of non-empty lines in the `git diff HEAD` it sees
   * into a file in its OWN directory (`%~dp0` on Windows, `$0`'s dir on POSIX) — never the repo
   * dir — so the no-edit case leaves the tree byte-identical, and prints the verdict JSON to
   * stdout, which `runDsh` takes as the agent's final text. On Windows `dsh` resolves to a .cmd
   * batch file that cross-spawn runs directly; on POSIX a sh script. `saw-len.txt` ends up in
   * `fakeDir` and holds the line count of the diff the fake reviewer read. */
  function writeFakeDsh(edit: boolean) {
    if (process.platform === "win32") {
      // `find /v /c ""` counts non-empty lines; `delims=*` makes %%g that whole count.
      const lines = [
        "@ECHO OFF",
        "git diff HEAD > \"%~dp0saw-diff.txt\" 2>nul",
        "set DLEN=0",
        "for /f \"delims=*\" %%g in ('find /v /c \"\" \"%~dp0saw-diff.txt\"') do set DLEN=%%g",
        "echo %DLEN% > \"%~dp0saw-len.txt\"",
        'echo {"approve": true, "issues": []}',
        edit ? `(type "" 2>nul & if not exist "c.ts" (echo const c = 1 > "c.ts"))` : "exit /b 0",
      ];
      fs.writeFileSync(path.join(fakeDir, "dsh.cmd"), lines.join("\r\n") + "\r\n");
    } else {
      // POSIX: the fake is launched with cwd = repo dir, so writing recording files into the
      // cwd would create untracked files in the repo and trip the diff-restore guard (the no-edit
      // case must leave the tree byte-identical). `dirname $0` is the fake's own dir (fakeDir),
      // so write there instead. cross-spawn runs the absolute path, so $0 is the absolute fake
      // path and dirname $0 == fakeDir.
      const lines = [
        "#!/bin/sh",
        edit ? "[ -f c.ts ] || echo 'const c = 1' > c.ts" : "true",
        'git diff HEAD > "$(dirname "$0")/saw-diff.txt" 2>/dev/null',
        'awk \'NF { c++ } END { print c+0 }\' "$(dirname "$0")/saw-diff.txt" > "$(dirname "$0")/saw-len.txt"',
        'echo \'{"approve": true, "issues": []}\'',
      ];
      fs.writeFileSync(path.join(fakeDir, "dsh"), lines.join("\n") + "\n", { mode: 0o755 });
    }
  }

  beforeEach(() => {
    dir = setupRepo();
    fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-fake-dsh-"));
    // Simulate the fixer's uncommitted work (the candidate diff the judge will score).
    fs.writeFileSync(path.join(dir, "a.ts"), "const a = 2;\n");
    fs.writeFileSync(path.join(dir, "b.ts"), "const b = 1;\n");
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

  it("reviewer that edits files: verdict discarded, pre-review diff survives", async () => {
    writeFakeDsh(true);
    const diffBefore = run("git", ["diff", "HEAD", "--binary"], dir).output;
    const statusBefore = run("git", ["status", "--porcelain"], dir).output;
    expect(diffBefore).toContain("const a = 2"); // the fixer's edit
    expect(statusBefore).toContain("b.ts"); // the fixer's new file

    const review = await runReviewer(dir);

    // The reviewer's verdict is discarded because it modified the tree.
    expect(review.approve).toBe(false);
    expect(review.issues[0]).toBe("reviewer modified files; result discarded");
    // The fixer's pre-review diff and new file survive the restore.
    expect(run("git", ["diff", "HEAD", "--binary"], dir).output).toBe(diffBefore);
    expect(run("git", ["status", "--porcelain"], dir).output).toBe(statusBefore);
    expect(fs.readFileSync(path.join(dir, "a.ts"), "utf8")).toBe("const a = 2;\n");
    expect(fs.existsSync(path.join(dir, "b.ts"))).toBe(true);
    // The reviewer's own addition is gone.
    expect(fs.existsSync(path.join(dir, "c.ts"))).toBe(false);
  });

  it("reviewer that makes no edits: verdict kept, tree unchanged, and it saw a non-empty diff", async () => {
    writeFakeDsh(false);
    const diffBefore = run("git", ["diff", "HEAD", "--binary"], dir).output;
    const statusBefore = run("git", ["status", "--porcelain"], dir).output;
    expect(diffBefore).not.toBe(""); // the fixer's work is a real, non-empty diff

    const review = await runReviewer(dir);

    // Read-only reviewer: verdict is trusted, tree is untouched.
    expect(review.approve).toBe(true);
    expect(fs.readFileSync(path.join(dir, "a.ts"), "utf8")).toBe("const a = 2;\n");
    expect(fs.existsSync(path.join(dir, "b.ts"))).toBe(true);
    expect(run("git", ["diff", "HEAD", "--binary"], dir).output).toBe(diffBefore);
    expect(run("git", ["status", "--porcelain"], dir).output).toBe(statusBefore);
    // The fake reviewer recorded the line count of the `git diff` it read, in its own directory
    // (never the repo dir, so the no-edit tree stayed byte-identical): it must be non-zero,
    // i.e. the un-staged tree (not an empty staged one) is what the agent saw. `find /v /c`
    // prints "---- <file>: N" so pull the number out of the tail.
    const sawLenRaw = fs.readFileSync(path.join(fakeDir, "saw-len.txt"), "utf8").trim();
    const m = sawLenRaw.match(/(\d+)\s*$/);
    expect(m, `saw-len.txt was ${JSON.stringify(sawLenRaw)}`).not.toBeNull();
    const sawLen = Number(m![1]);
    expect(sawLen).toBeGreaterThan(0);
  });
});
