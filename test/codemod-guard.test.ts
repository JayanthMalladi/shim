import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codemodExportFindings } from "../src/codemod-guard.js";

function repo(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-guard-"));
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir });
  git("init", "-q");
  for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), t);
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return dir;
}

describe("codemod export guard", () => {
  it("flags an export the codemod renamed (cloudflare/ai google provider)", () => {
    const dir = repo({
      "google.ts": 'import { createGoogleGenerativeAI as orig } from "@ai-sdk/google";\nexport const createGoogleGenerativeAI = orig;\n',
      "index.ts": 'export { createGoogleGenerativeAI } from "./google";\n',
    });
    fs.writeFileSync(path.join(dir, "google.ts"), 'import { createGoogle as orig } from "@ai-sdk/google";\nexport const createGoogle = orig;\n');
    fs.writeFileSync(path.join(dir, "index.ts"), 'export { createGoogle } from "./google";\n');
    const f = codemodExportFindings(dir);
    expect(f.map((x) => `${x.file}:${x.ruleId}:${x.snippet}`)).toEqual([
      "google.ts:codemod-renamed-export:export createGoogleGenerativeAI",
      "index.ts:codemod-renamed-export:export createGoogleGenerativeAI",
    ]);
  });

  it("does not flag an import-only change", () => {
    const dir = repo({ "a.ts": 'import { createGoogleGenerativeAI } from "@ai-sdk/google";\nexport const g = createGoogleGenerativeAI();\n' });
    fs.writeFileSync(path.join(dir, "a.ts"), 'import { createGoogle } from "@ai-sdk/google";\nexport const g = createGoogle();\n');
    expect(codemodExportFindings(dir)).toEqual([]);
  });
});
