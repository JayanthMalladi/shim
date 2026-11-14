import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { getMigration, type Migration } from "../src/migrations.js";
import { scanWith } from "../src/scan.js";
import type { Finding } from "../src/types.js";

/** Express 4 code the scanner should flag when the baseline still says v4: a splat route (auto) and res.sendfile (agent). */
const APP = `import express from "express";

const app = express();
app.get("/x/*", (req, res) => res.json({ ok: true }));
app.get("/f", (req, res) => res.sendfile("f.txt"));
`;

const P4 = JSON.stringify({ name: "app", private: true, dependencies: { express: "^4.21.0" } });
const P5 = JSON.stringify({ name: "app", private: true, dependencies: { express: "^5.0.0" } });

function git(dir: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" }).trim();
}

/** A temp git repo: commit 1 with `files1`, commit 2 writing `files2` over it. Returns the two SHAs. */
function twoCommitRepo(files1: Record<string, string>, files2: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-express-baseline-"));
  git(dir, "init", "-q");
  for (const [rel, text] of Object.entries(files1)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "express 4");
  const c1 = git(dir, "rev-parse", "HEAD");
  for (const [rel, text] of Object.entries(files2)) fs.writeFileSync(path.join(dir, rel), text);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "bump express to 5");
  const c2 = git(dir, "rev-parse", "HEAD");
  return { dir, c1, c2 };
}

/** The scan's findings, with Windows path separators normalised to /. */
function find(dir: string, m: Migration, opts?: { baselineRef?: string }): Finding[] {
  const { result } = scanWith(dir, m, opts);
  return result.findings.map((f) => ({ ...f, file: f.file.replace(/\\/g, "/") }));
}

describe("express v5 baselineRef gate", () => {
  const m = getMigration("express-v5");

  it("a default scan at the bump commit (HEAD) sees no code findings", () => {
    // Commit 1: express ^4 + the breaking code. Commit 2: only the express bump to ^5.
    const { dir, c2 } = twoCommitRepo({ "package.json": P4, "src/app.ts": APP }, { "package.json": P5 });
    const f = find(dir, m); // baselineRef defaults to HEAD = c2
    expect(f.length, JSON.stringify(f, null, 2)).toBe(0);
    // sanity: the working tree really is at the bump
    expect(git(dir, "rev-parse", "HEAD")).toBe(c2);
  });

  it("baselineRef = the pre-bump commit brings the findings back", () => {
    const { dir, c1 } = twoCommitRepo({ "package.json": P4, "src/app.ts": APP }, { "package.json": P5 });
    const f = find(dir, m, { baselineRef: c1 });
    const ruleIds = f.map((x) => x.ruleId).sort();
    expect(ruleIds).toEqual(["express-sendfile", "express-splat-param"]);
    expect(f.every((x) => x.file === "src/app.ts")).toBe(true);
  });

  it("monorepo: the v4->v5 package is scanned, the already-v5 package is skipped", () => {
    const mono1 = {
      "package.json": JSON.stringify({ name: "mono", private: true }),
      "packages/a/package.json": JSON.stringify({ name: "a", dependencies: { express: "^4.21.0" } }),
      "packages/a/src/a.ts": APP,
      "packages/b/package.json": JSON.stringify({ name: "b", dependencies: { express: "^5.1.0" } }),
      "packages/b/src/b.ts": APP,
    };
    // Commit 2 bumps only package A to ^5; B was already on ^5 at commit 1.
    const { dir, c1 } = twoCommitRepo(mono1, {
      "packages/a/package.json": JSON.stringify({ name: "a", dependencies: { express: "^5.0.0" } }),
    });

    const atHead = find(dir, m);
    expect(atHead.length, JSON.stringify(atHead, null, 2)).toBe(0); // both packages look already-on-5 at HEAD

    const atC1 = find(dir, m, { baselineRef: c1 });
    const aFindings = atC1.filter((f) => f.file.startsWith("packages/a/"));
    const bFindings = atC1.filter((f) => f.file.startsWith("packages/b/"));
    expect(aFindings.map((f) => f.ruleId).sort()).toEqual(["express-sendfile", "express-splat-param"]);
    expect(bFindings, "package B was already on v5 at the baseline: it must not be flagged").toEqual([]);
  });
});
