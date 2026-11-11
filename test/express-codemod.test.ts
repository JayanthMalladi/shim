import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expressCodemodUnexpressRestore } from "../src/express-codemod.js";

/**
 * The official codemod's prettier pass rewrites files that never import express (style churn:
 * parens around await, semicolons). expressCodemodUnexpressRestore restores those; a file whose
 * committed text uses express keeps the codemod's edits.
 */
describe("expressCodemodUnexpressRestore", () => {
  /** A temp git repo: commit the given files, then apply the same changes in the working tree. */
  const repo = (files: Record<string, string>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-express-restore-"));
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir });
    git("init", "-q");
    for (const [f, t] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), t);
    }
    git("add", "-A");
    git("commit", "-q", "-m", "init");
    return dir;
  };

  it("restores a changed file with no express import, keeps one that has it", () => {
    const dir = repo({
      "src/app.js": 'require("express");\nconst a=1;\n',
      "src/util.js": "export const x = (a) => a;\n",
    });
    // Simulate the codemod: both files changed (the express one for a real reason, the other as churn).
    fs.writeFileSync(path.join(dir, "src", "app.js"), "require('express');\nconst a = 1;\n");
    fs.writeFileSync(path.join(dir, "src", "util.js"), "export const x = (a) => {\n  return a;\n};\n");

    const restored = expressCodemodUnexpressRestore(dir);

    expect(restored).toEqual(["src/util.js"]); // only the non-express file was restored
    // The non-express file is byte-identical to its committed text again.
    expect(fs.readFileSync(path.join(dir, "src", "util.js"), "utf8")).toBe("export const x = (a) => a;\n");
    // The express file keeps the codemod's edit.
    expect(fs.readFileSync(path.join(dir, "src", "app.js"), "utf8")).toBe("require('express');\nconst a = 1;\n");
  });

  it("restores nothing when the changed file's committed text imports express", () => {
    const dir = repo({ "src/server.js": 'import express from "express";\nexport default express();\n' });
    fs.writeFileSync(path.join(dir, "src", "server.js"), 'import express from "express";\nexport const app = express();\n');
    expect(expressCodemodUnexpressRestore(dir)).toEqual([]);
    expect(fs.readFileSync(path.join(dir, "src", "server.js"), "utf8")).toContain("export const app = express();");
  });
});
