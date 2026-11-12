import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseVitestJson, parseJestJson, detectTestRunner, regressions, runGates, isYarnBerry, installCmd, type GateResults } from "../src/gates.js";
import type { ExecResult } from "../src/exec.js";

// A fresh temp dir with the marker files for a given package manager, so the
// filesystem-dependent install command form can be asserted without a real install.
function pmDir(pm: "npm" | "pnpm" | "yarn" | "bun" | "yarn-berry"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-pm-"));
  const pkg = { name: pm, private: true, scripts: { test: "echo ok" } };
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  if (pm === "npm") fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");
  if (pm === "pnpm") fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
  if (pm === "yarn" || pm === "yarn-berry") fs.writeFileSync(path.join(dir, "yarn.lock"), "");
  if (pm === "yarn-berry") fs.writeFileSync(path.join(dir, ".yarnrc.yml"), "nodeLinker: node-modules\n");
  if (pm === "bun") fs.writeFileSync(path.join(dir, "bun.lockb"), "");
  return dir;
}

describe("isYarnBerry", () => {
  it("detects Berry via .yarnrc.yml, not classic Yarn 1", () => {
    const berry = pmDir("yarn-berry");
    const classic = pmDir("yarn");
    expect(isYarnBerry(berry)).toBe(true);
    expect(isYarnBerry(classic)).toBe(false);
  });
});

describe("installCmd per package manager", () => {
  it("classic Yarn 1 keeps --ignore-scripts and --frozen-lockfile (unchanged)", () => {
    const dir = pmDir("yarn");
    const c = installCmd(dir, "yarn", true);
    expect(c.env).toBeUndefined();
    expect(c.args).toEqual(["install", "--ignore-scripts", "--frozen-lockfile"]);
  });

  it("Yarn Berry uses YARN_ENABLE_SCRIPTS=0 and --immutable, never --ignore-scripts", () => {
    const dir = pmDir("yarn-berry");
    const c = installCmd(dir, "yarn", true);
    expect(c.cmd).toBe("yarn");
    expect(c.args).toEqual(["install", "--immutable"]);
    expect(c.args).not.toContain("--ignore-scripts");
    expect(c.args).not.toContain("--frozen-lockfile");
    expect(c.env?.YARN_ENABLE_SCRIPTS).toBe("0");
  });

  it("Yarn Berry without frozen omits --immutable but still disables scripts", () => {
    const dir = pmDir("yarn-berry");
    const c = installCmd(dir, "yarn", false);
    expect(c.args).toEqual(["install"]);
    expect(c.env?.YARN_ENABLE_SCRIPTS).toBe("0");
  });

  it("pnpm/bun/npm install forms are unchanged", () => {
    expect(installCmd(pmDir("pnpm"), "pnpm", true).args).toEqual(["install", "--ignore-scripts", "--frozen-lockfile"]);
    expect(installCmd(pmDir("bun"), "bun", true).args).toEqual(["install", "--ignore-scripts", "--frozen-lockfile"]);
    // npm: a lockfile is present, frozen -> ci
    const npmC = installCmd(pmDir("npm"), "npm", true);
    expect(npmC.args[0]).toBe("ci");
    expect(npmC.args).toContain("--ignore-scripts");
  });
});

const ok = { ok: true, code: 0, output: "", ms: 0 };
const fail = { ...ok, ok: false, code: 1 };
/** Build a GateResults entry for a test gate, with a per-test map. */
const testGate = (gateName: string, perTest: ExecResult["perTest"], okFlag: boolean): { gate: GateResults } => ({
  gate: { [gateName]: { ...ok, ok: okFlag, perTest } },
});

// Parse the two runner fixtures, exercising each parser's own file key.
const vt = (name: string) => parseVitestJson(
  path.join(import.meta.dirname, "fixtures/vitest-per-test", name), "D:/repo");
const jt = (name: string) => parseJestJson(
  path.join(import.meta.dirname, "fixtures/jest-per-test", name), "D:/repo");

describe("detectTestRunner", () => {
  it("prefers the script text over devDependencies", () => {
    expect(detectTestRunner("vitest run", { devDependencies: { jest: "^29" } })).toBe("vitest");
    expect(detectTestRunner("jest", {})).toBe("jest");
    expect(detectTestRunner("mocha", { devDependencies: { vitest: "^3" } })).toBe("vitest");
    expect(detectTestRunner("mocha", { devDependencies: { jest: "^29" } })).toBe("jest");
    expect(detectTestRunner("mocha", { devDependencies: { mocha: "^10" } })).toBeUndefined();
    expect(detectTestRunner(undefined, { devDependencies: { jest: "^29" } })).toBe("jest");
  });
});

describe("per-test JSON parsers", () => {
  it("reads vitest's testResults[].name and assertionResults", () => {
    expect(vt("baseline.json")).toEqual({
      "test/a.test.ts/billing sums": true,
      "test/a.test.ts/billing renders": true,
      "test/a.test.ts/billing refunds": false,
    });
  });
  it("reads jest's testResults[].testFilePath and assertionResults", () => {
    expect(jt("baseline.json")).toEqual({
      "test/c.test.js/auth login": true,
      "test/c.test.js/auth logout": true,
      "test/c.test.js/auth token": false,
    });
  });
  it("returns undefined when the file is missing or unreadable", () => {
    expect(vt("does-not-exist.json")).toBeUndefined();
    expect(jt("does-not-exist.json")).toBeUndefined();
  });
});

describe("regressions with per-test results", () => {
  it("flags a red gate as regressed when a test that passed at baseline now fails (vitest)", () => {
    const baseline = testGate("test .", vt("baseline.json"), false).gate;
    const after = testGate("test .", vt("after-regressed.json"), false).gate;
    // The gate itself was red at baseline and is still red, but a previously passing test ("billing
    // sums") now fails, so this must be reported even though the old gate-level comparison would not.
    expect(regressions(baseline, after)).toEqual(["test ."]);
  });

  it("does not flag a red gate when only already-failing tests still fail (vitest)", () => {
    const baseline = testGate("test .", vt("baseline.json"), false).gate;
    const after = testGate("test .", vt("after-not-regressed.json"), false).gate;
    expect(regressions(baseline, after)).toEqual([]);
  });

  it("flags a regression when a test that passed at baseline is now missing (jest)", () => {
    const baseline = testGate("test .", jt("baseline.json"), false).gate;
    const after = testGate("test .", jt("after-regressed.json"), false).gate;
    // "auth logout" passed at baseline and is absent from the after run: that is a regression.
    expect(regressions(baseline, after)).toEqual(["test ."]);
  });

  it("keeps the gate-level comparison for runners without per-test data", () => {
    // A green gate that went red is still a regression with no perTest map (other runners).
    const baseline = { "test .": ok, "typecheck .": ok };
    expect(regressions(baseline, { "test .": fail, "typecheck .": ok })).toEqual(["test ."]);
    // A red gate stays ignored without perTest data (today's behavior for other runners).
    expect(regressions(baseline, { "test .": fail, "typecheck .": ok, "typecheck .x": ok })[0]).toBe("test .");
    expect(regressions({ "test .": fail }, { "test .": fail })).toEqual([]);
  });

  it("does not flag when a previously-failing test stays failing", () => {
    const baseline = testGate("test .", { "a/b": false, "a/c": true }, false).gate;
    const after = testGate("test .", { "a/b": false, "a/c": true }, false).gate;
    expect(regressions(baseline, after)).toEqual([]);
  });

  it("ignores a new test that appears and fails (only lost tests count)", () => {
    const baseline = testGate("test .", { "a/known": true }, false).gate;
    const after = testGate("test .", { "a/known": true, "a/new": false }, false).gate;
    expect(regressions(baseline, after)).toEqual([]);
  });
});

describe("runGates captures per-test data for vitest gates", () => {
  // A real vitest run in a temp dir (install skipped, JSON reporter capture is what's under test).
  // The repo's own node_modules is linked in so `npx --no-install vitest` resolves; the test is
  // skipped when that link cannot be made (no install) because the parsers are covered by the
  // fixture JSON above.
  const repoNodeModules = path.join(import.meta.dirname, "..", "node_modules");
  const canRunVitest = fs.existsSync(path.join(repoNodeModules, ".bin", "vitest"));

  const mkRepo = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-pt-"));
    fs.symlinkSync(repoNodeModules, path.join(dir, "node_modules"), "junction");
    fs.mkdirSync(path.join(dir, "test"), { recursive: true });
    fs.writeFileSync(path.join(dir, "test", "t.test.ts"), `import { it, expect } from "vitest";\nit("works", () => expect(1).toBe(1));\n`);
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
      name: "pt", private: true, type: "module",
      scripts: { test: "vitest run" },
      devDependencies: { vitest: "^3.2.7" },
    }));
    return dir;
  };

  (canRunVitest ? it : it.skip)("attaches perTest to the test gate when the runner is vitest", () => {
    const dir = mkRepo();
    const res = runGates(dir, "npm", false, [dir], { install: false });
    const gate = res["test ."];
    expect(gate?.ok).toBe(true);
    expect(gate?.perTest).toEqual({ "test/t.test.ts/works": true });
  }, 120_000);
});

describe("runGates drops untracked files the gates create", () => {
  it("removes new build output, keeps earlier untracked files, ignored files and node_modules", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-clean-"));
    const sh = (...a: string[]) => execFileSync("git", a, { cwd: dir });
    sh("init", "-q");
    fs.writeFileSync(path.join(dir, ".gitignore"), "dist/\n");
    const build = "const fs=require('fs');for(const d of ['out','dist','node_modules/x'])fs.mkdirSync(d,{recursive:true});"
      + "fs.writeFileSync('out/a.js','x');fs.writeFileSync('dist/b.js','x');fs.writeFileSync('node_modules/x/c.js','x')";
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "c", private: true, scripts: { build: `node -e "${build}"` } }));
    sh("add", "-A");
    sh("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
    fs.writeFileSync(path.join(dir, "new.ts"), "export {};\n"); // a fixer's new file

    const res = runGates(dir, "npm", false, [], { install: false });

    expect(res.build?.ok).toBe(true);
    expect(fs.existsSync(path.join(dir, "out", "a.js"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "new.ts"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "dist", "b.js"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "node_modules", "x", "c.js"))).toBe(true);
  }, 60_000);
});
