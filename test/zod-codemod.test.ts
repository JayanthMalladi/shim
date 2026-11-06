import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { zodCodemodGuard } from "../src/zod-codemod.js";

/** A committed temp repo; `edit` then simulates the codemod's changes on top. */
function repo(files: Record<string, string>, edit: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zod-guard-"));
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  for (const [rel, text] of Object.entries(edit)) write(rel, text);
  return dir;
}

const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), "utf8");

describe("zodCodemodGuard", () => {
  it("keeps edits in files that import from exactly zod", () => {
    const dir = repo(
      { "a.ts": 'import { z } from "zod";\nexport const s = z.string().email();\n' },
      { "a.ts": 'import { z } from "zod";\nexport const s = z.email();\n' },
    );
    expect(zodCodemodGuard(dir)).toEqual([]);
    expect(read(dir, "a.ts")).toContain("z.email()");
  });

  it("keeps edits in a file that requires zod", () => {
    const dir = repo(
      { "a.js": 'const { z } = require("zod");\nmodule.exports = z.string().email();\n' },
      { "a.js": 'const { z } = require("zod");\nmodule.exports = z.email();\n' },
    );
    expect(zodCodemodGuard(dir)).toEqual([]);
    expect(read(dir, "a.js")).toContain("z.email()");
  });

  it('reverts a "zod/v3" file without a finding', () => {
    const before = 'import { z } from "zod/v3";\nexport const s = z.string().uuid();\n';
    const dir = repo({ "v3.ts": before }, { "v3.ts": 'import { z } from "zod";\nexport const s = z.uuid();\n' });
    expect(zodCodemodGuard(dir)).toEqual([]);
    expect(read(dir, "v3.ts")).toBe(before);
  });

  it("reverts a file with no zod import", () => {
    const before = "export const n = 1;\n";
    const dir = repo({ "other.ts": before }, { "other.ts": "export const n = 2;\n" });
    expect(zodCodemodGuard(dir)).toEqual([]);
    expect(read(dir, "other.ts")).toBe(before);
  });

  it('reverts and reports a file that imports both "zod" and "zod/v3" when the codemod rewrote the v3 import', () => {
    const before = 'import { z } from "zod";\nimport { z as z3 } from "zod/v3";\nexport const a = z.string();\nexport const b = z3.string();\n';
    const dir = repo({ "mixed.ts": before }, { "mixed.ts": 'import { z } from "zod";\nimport { z as z3 } from "zod";\nexport const a = z.string();\nexport const b = z3.string();\n' });
    const findings = zodCodemodGuard(dir);
    expect(findings.map((f) => [f.ruleId, f.file, f.severity, f.fix])).toEqual([["codemod-touched-unrelated", "mixed.ts", "silent", "manual"]]);
    expect(read(dir, "mixed.ts")).toBe(before);
  });

  it("keeps edits in a long file whose zod import is far from the end", () => {
    const filler = "// filler line to push the import out of the last 8000 characters\n".repeat(200);
    const dir = repo(
      { "big.ts": `import { z } from "zod";\n${filler}export const s = z.string().email();\n` },
      { "big.ts": `import { z } from "zod";\n${filler}export const s = z.email();\n` },
    );
    expect(zodCodemodGuard(dir)).toEqual([]);
    expect(read(dir, "big.ts")).toContain("z.email()");
  });

  it("ignores changes to non-code files", () => {
    const dir = repo({ "package.json": '{ "dependencies": { "zod": "^3.25.0" } }\n' }, { "package.json": '{ "dependencies": { "zod": "^4.0.0" } }\n' });
    expect(zodCodemodGuard(dir)).toEqual([]);
    expect(read(dir, "package.json")).toContain("^4.0.0");
  });
});
