import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseReview } from "../src/agent.js";
import { rank, type Candidate } from "../src/candidates.js";
import { run } from "../src/exec.js";
import { gateOrder, runGates } from "../src/gates.js";
import { formatChanged } from "../src/pipeline.js";

const ok = { ok: true, code: 0, output: "", ms: 0 };
const fail = { ...ok, ok: false, code: 1 };
const cand = (dir: string, size: number, after: Candidate["after"], remaining = 0): Candidate => ({
  dir, size, after, agentRuns: [], remaining: Array(remaining).fill({}),
  ok: Object.values(after).every((r) => r.ok) && remaining === 0,
});

describe("parseReview", () => {
  it("reads the last JSON line", () => {
    expect(parseReview('Looks fine.\n{"approve": true, "issues": []}')).toEqual({ approve: true, issues: [] });
    expect(parseReview('{"approve": true}\nOn reflection:\n{"approve": false, "issues": ["a.ts:3 drops finalStep"]}'))
      .toEqual({ approve: false, issues: ["a.ts:3 drops finalStep"] });
  });
  it("treats a missing or broken verdict as a rejection", () => {
    expect(parseReview("I ran out of turns").approve).toBe(false);
    expect(parseReview('{"approve": tru').approve).toBe(false);
  });
});

describe("rank", () => {
  const baseline = { "typecheck .": ok, "test .": ok };
  it("prefers passing candidates, then the smallest diff", () => {
    const big = cand("big", 40, baseline);
    const small = cand("small", 6, baseline);
    const broken = cand("broken", 2, { "typecheck .": fail, "test .": ok });
    expect(rank([big, broken, small], baseline).map((c) => c.dir)).toEqual(["small", "big", "broken"]);
  });
  it("among failures, prefers fewer regressions, then fewer findings left", () => {
    const twoRed = cand("twoRed", 1, { "typecheck .": fail, "test .": fail });
    const oneRed = cand("oneRed", 9, { "typecheck .": fail, "test .": ok }, 2);
    const oneRedClean = cand("oneRedClean", 9, { "typecheck .": fail, "test .": ok });
    expect(rank([twoRed, oneRed, oneRedClean], baseline).map((c) => c.dir)).toEqual(["oneRedClean", "oneRed", "twoRed"]);
  });
});

describe("gateOrder", () => {
  it("checks the root, then published packages, then private demos", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shim-gates-"));
    const pkg = (rel: string, json: object) => {
      fs.mkdirSync(path.join(root, rel), { recursive: true });
      fs.writeFileSync(path.join(root, rel, "package.json"), JSON.stringify(json));
      return path.join(root, rel);
    };
    const demo = pkg("demos/a", { name: "a", private: true });
    const lib = pkg("packages/z-provider", { name: "z-provider" });
    expect(gateOrder(root, [demo, lib, root])).toEqual([root, lib, demo]);
  });
});

describe("runGates typecheck", () => {
  const pkg = (scripts: object, files: Record<string, string> = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-tc-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "p", scripts }));
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    return dir;
  };
  const gates = (dir: string) => runGates(dir, "npm", false, [dir], { install: false });

  it("runs the package's own typecheck script instead of tsc -p tsconfig.json", () => {
    // The tsconfig is broken: the old gate would have failed or not run; the script is what the repo relies on.
    const dir = pkg({ typecheck: "node -e 0" }, { "tsconfig.json": "{ not json" });
    expect(gates(dir)["typecheck ."]?.ok).toBe(true);
    const red = pkg({ typecheck: "node -e process.exit(1)" }, { "tsconfig.json": "{}" });
    expect(gates(red)["typecheck ."]?.ok).toBe(false);
  });
  it("adds no typecheck gate without a script or a tsconfig", () => {
    expect(Object.keys(gates(pkg({})))).toEqual(["install"]);
  });
});

describe("formatChanged", () => {
  // Stand-ins whose only rule is double quotes, so the tests need no install.
  const fakePrettier = `#!/usr/bin/env node
const fs = require("fs");
const fmt = (s) => s.replace(/'/g, '"');
const args = process.argv.slice(2);
if (args.includes("--stdin-filepath")) process.stdout.write(fmt(fs.readFileSync(0, "utf8")));
else for (const f of args.filter((a) => a !== "--write")) fs.writeFileSync(f, fmt(fs.readFileSync(f, "utf8")));
`;
  // Like eslint: JSON on stdout for --fix-dry-run (with `output` only when a fix would change the text), exit 1 on lint errors.
  const fakeEslint = `#!/usr/bin/env node
const fs = require("fs");
const fmt = (s) => s.replace(/'/g, '"');
const args = process.argv.slice(2);
if (args.includes("--stdin")) {
  const src = fs.readFileSync(0, "utf8");
  console.log(JSON.stringify([{ filePath: "x", messages: [{ ruleId: "other", severity: 2 }], ...(fmt(src) === src ? {} : { output: fmt(src) }) }]));
  process.exit(1);
}
for (const f of args.filter((a) => a !== "--fix")) fs.writeFileSync(f, fmt(fs.readFileSync(f, "utf8")));
`;
  const brokenEslint = "#!/usr/bin/env node\nconsole.error('Oops, config error'); process.exit(2);\n";

  /**
   * A repo with one tool installed, a file that was clean and one that wasn't, then Shim's
   * single-quoted edit to each.
   *
   * `npx --no-install` resolves the tool by package name: it needs `node_modules/<tool>/package.json`
   * plus the bin script. The `.bin` entry is how the bin is actually run — a `.cmd` batch shim on
   * Windows (cmd.exe can't execute shebang scripts directly), a Unix executable on POSIX.
   */
  const installTool = (dir: string, tool: string, script: string) => {
    // Full npm-style layout so `npx --no-install <tool>` can resolve it by name.
    const pkgDir = path.join(dir, "node_modules", tool);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "package.json"),
      JSON.stringify({ name: tool, version: "1.0.0", bin: { [tool]: `${tool}.js` } }));
    const jsPath = path.join(pkgDir, `${tool}.js`);
    fs.writeFileSync(jsPath, script.replace(/^#!.*\n/, "")); // shebang is irrelevant when run via node
    const binPath = path.join(dir, "node_modules", ".bin", tool);
    fs.mkdirSync(path.dirname(binPath), { recursive: true });
    if (process.platform === "win32") {
      // cmd batch shim; npx and cross-spawn both resolve <tool>.cmd on Windows.
      fs.writeFileSync(binPath + ".cmd", `@ECHO OFF\r\nnode "${jsPath.replace(/\\/g, "\\/")}" %*\r\n`);
    } else {
      fs.writeFileSync(binPath, script, { mode: 0o755 });
    }
  };
  const repo = (tool: "prettier" | "eslint", script: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-fmt-"));
    const write = (f: string, text: string) => fs.writeFileSync(path.join(dir, f), text);
    const git = (...args: string[]) => run("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], dir);
    installTool(dir, tool, script);
    write("package.json", JSON.stringify({ devDependencies: { [tool]: "*" } }));
    write("clean.ts", 'const a = "x";\n');
    write("dirty.ts", "const a = 'x';\n");
    git("init", "-q");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
    write("clean.ts", 'const a = "x";\nconst b = \'y\';\n');
    write("dirty.ts", "const a = 'x';\nconst b = 'y';\n");
    formatChanged(dir);
    return (f: string) => fs.readFileSync(path.join(dir, f), "utf8");
  };
  const CLEAN_FIXED = 'const a = "x";\nconst b = "y";\n';
  const DIRTY_UNTOUCHED = "const a = 'x';\nconst b = 'y';\n";

  it("formats only files that were formatter-clean before the edit", () => {
    const read = repo("prettier", fakePrettier);
    expect(read("clean.ts")).toBe(CLEAN_FIXED);
    expect(read("dirty.ts")).toBe(DIRTY_UNTOUCHED);
  });

  it("runs eslint --fix only on files that had no autofixes pending before the edit", () => {
    const read = repo("eslint", fakeEslint);
    expect(read("clean.ts")).toBe(CLEAN_FIXED);
    expect(read("dirty.ts")).toBe(DIRTY_UNTOUCHED);
  });

  it("skips files when eslint can't run on stdin", () => {
    const read = repo("eslint", brokenEslint);
    expect(read("clean.ts")).toBe('const a = "x";\nconst b = \'y\';\n');
    expect(read("dirty.ts")).toBe(DIRTY_UNTOUCHED);
  });
});

describe("msUntilReset", () => {
  it("parses the plan limit message", async () => {
    const { msUntilReset } = await import("../src/exec.js");
    const now = new Date("2026-10-27T21:43:00Z");
    expect(msUntilReset("You've hit your session limit · resets 10pm (UTC)", now)).toBe(19 * 60_000);
    expect(msUntilReset("resets 3:30am (UTC)", now)).toBe((5 * 60 + 49) * 60_000);
    expect(msUntilReset("no reset here", now)).toBeUndefined();
  });
});
