import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { run } from "../src/exec.js";

/**
 * The reviewer diff-restore guard in agent.ts captures `git diff HEAD --binary` and
 * `git status --porcelain` before the agent runs, and restores the tree (git checkout -- .
 * + git clean -fd) if the tree differs afterwards. These tests verify the git snapshot/restore
 * mechanics directly (without running a real agent) so that the guard logic is covered by the
 * unit test suite.
 */
function setupRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-reviewer-guard-"));
  run("git", ["init", "-q"], dir);
  run("git", ["config", "user.name", "test"], dir);
  run("git", ["config", "user.email", "test@test"], dir);
  fs.writeFileSync(path.join(dir, "src.ts"), "const x = 1;\n");
  run("git", ["add", "."], dir);
  run("git", ["commit", "-q", "-m", "init"], dir);
  return dir;
}

describe("reviewer diff-restore guard (git snapshot/restore mechanics)", () => {
  let dir: string;
  beforeEach(() => { dir = setupRepo(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("git diff HEAD --binary captures the pre-agent tree state", () => {
    const before = run("git", ["diff", "HEAD", "--binary"], dir).output;
    expect(before).toBe(""); // clean tree
    // Modify a file so the diff is non-empty
    fs.writeFileSync(path.join(dir, "src.ts"), "const x = 2;\n");
    const after = run("git", ["diff", "HEAD", "--binary"], dir).output;
    expect(after).not.toBe(before);
  });

  it("git status --porcelain detects untracked files", () => {
    const before = run("git", ["status", "--porcelain"], dir).output;
    expect(before).toBe(""); // clean tree
    fs.writeFileSync(path.join(dir, "new-file.ts"), "const y = 1;\n");
    const after = run("git", ["status", "--porcelain"], dir).output;
    expect(after).toContain("new-file.ts");
  });

  it("git checkout -- . and git clean -fd restore the tree to the snapshot state", () => {
    const diffBefore = run("git", ["diff", "HEAD", "--binary"], dir).output;
    const statusBefore = run("git", ["status", "--porcelain"], dir).output;
    // Simulate a reviewer modifying a tracked file and creating an untracked file
    fs.writeFileSync(path.join(dir, "src.ts"), "const x = 99;\n");
    fs.writeFileSync(path.join(dir, "rogue.ts"), "const z = 1;\n");
    run("git", ["checkout", "--", "."], dir);
    run("git", ["clean", "-fd"], dir);
    const diffAfter = run("git", ["diff", "HEAD", "--binary"], dir).output;
    const statusAfter = run("git", ["status", "--porcelain"], dir).output;
    expect(diffAfter).toBe(diffBefore);
    expect(statusAfter).toBe(statusBefore);
  });

  it("the restore is idempotent: running it twice leaves the tree clean", () => {
    run("git", ["checkout", "--", "."], dir);
    run("git", ["clean", "-fd"], dir);
    run("git", ["checkout", "--", "."], dir);
    run("git", ["clean", "-fd"], dir);
    expect(run("git", ["diff", "HEAD", "--binary"], dir).output).toBe("");
    expect(run("git", ["status", "--porcelain"], dir).output).toBe("");
  });
});
