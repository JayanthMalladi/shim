// T12: on log-10x, schema chains span several lines. R1's rewrite indented the rest of the chain
// by an extra level, and R9's finding sat on the chain's first line while its edit landed on the
// `.default` line, so the PR text listed an applied fix under "Shim did not change these".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getMigration } from "../src/migrations.js";
import { scanAndFixWith } from "../src/scan.js";

async function fix(src: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-zod-multiline-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "t", dependencies: { zod: "^3.24.4" } }));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src/a.ts"), src);
  const { result } = await scanAndFixWith(dir, getMigration("zod-v4"));
  return { findings: result.findings, out: fs.readFileSync(path.join(dir, "src/a.ts"), "utf8") };
}

describe("multi-line Zod chains", () => {
  // The second variant is log-10x's layout: another property above, so ts-morph computes a
  // fractional indentation level (0.5) for a 2-space file.
  for (const [ind, before] of [["  ", []], ["    ", []], ["  ", ["  environment: z.string().optional(),"]]] as const) {
    it(`R1 keeps the chain's indentation (${ind.length}-space indent${before.length ? ", property above" : ""})`, async () => {
      const lines = (withDefault: boolean) =>
        [
          "import { z } from 'zod';",
          "",
          "export const s = {",
          ...before,
          `${ind}view: z`,
          `${ind}${ind}.literal('summary')`,
          ...(withDefault ? [`${ind}${ind}.default('summary')`] : []),
          `${ind}${ind}.optional(),`,
          "};",
          "",
        ].join("\n");
      const { out } = await fix(lines(true));
      expect(out).toBe(lines(false));
    });
  }

  it("R9's finding is on the .default line, where the edit lands", async () => {
    const src = [
      "import { z } from 'zod';",
      "export const s = z",
      "  .object({",
      "    a: z.string().default('x'),",
      "  })",
      "  .default({})",
      "  .describe('y');",
      "",
    ].join("\n");
    const { findings, out } = await fix(src);
    const r9 = findings.filter((f) => f.ruleId === "zod-object-default");
    expect(r9.map((f) => f.line)).toEqual([6]);
    expect(out.split("\n")[5]).toBe("  .prefault({})");
  });
});
