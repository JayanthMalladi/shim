/**
 * S06d: unit tests for `parseDraft` (src/pack-builder/model.ts). Both paths are exercised
 * without a model: the answers.json file path and the JSON-in-text fallback.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDraft } from "../src/pack-builder/model.js";

type DraftAnswer = {
  evidence: string;
  rule?: { id: string };
  skip?: "loud" | "static" | "other";
  skipReason?: string;
};

function mkOutDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "shim-parse-draft-"));
}

describe("parseDraft", () => {
  it("reads answers.json when it exists in outDir", () => {
    const outDir = mkOutDir();
    try {
      const answers: DraftAnswer[] = [
        { evidence: "removed ZodError.errors", rule: { id: "zod-errors-removed" }, skip: undefined },
        { evidence: "z.string().uuid() stricter", skip: "static", skipReason: "tsc catches it" },
      ];
      fs.writeFileSync(path.join(outDir, "answers.json"), JSON.stringify(answers), "utf8");
      const result = parseDraft({ ok: true, code: 0, output: "this text is ignored" }, outDir);
      expect(result).toHaveLength(2);
      expect(result[0]!.rule!.id).toBe("zod-errors-removed");
      expect(result[1]!.skip).toBe("static");
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("prefers answers.json over the text fallback", () => {
    const outDir = mkOutDir();
    try {
      // answers.json has the right data; the text output is garbage.
      const answers: DraftAnswer[] = [{ evidence: "from file", rule: { id: "file-rule" } }];
      fs.writeFileSync(path.join(outDir, "answers.json"), JSON.stringify(answers), "utf8");
      const result = parseDraft(
        { ok: true, code: 0, output: "this is not valid JSON [[}" },
        outDir
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.evidence).toBe("from file");
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("falls back to parsing JSON from the final text when answers.json is absent", () => {
    const outDir = mkOutDir();
    try {
      const text = 'Some preamble text. [{"evidence":"from text","rule":{"id":"text-rule"}}] and trailing.';
      const result = parseDraft({ ok: true, code: 0, output: text }, outDir);
      expect(result).toHaveLength(1);
      expect(result[0]!.evidence).toBe("from text");
      expect(result[0]!.rule!.id).toBe("text-rule");
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("returns [] when neither answers.json nor parsable JSON is found", () => {
    const outDir = mkOutDir();
    try {
      const result = parseDraft({ ok: false, code: 1, output: "no json here at all" }, outDir);
      expect(result).toEqual([]);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("returns [] when answers.json is present but invalid JSON", () => {
    const outDir = mkOutDir();
    try {
      fs.writeFileSync(path.join(outDir, "answers.json"), "not json {{{", "utf8");
      const result = parseDraft({ ok: true, code: 0, output: 'also not json' }, outDir);
      expect(result).toEqual([]);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("works when outDir is not provided (text-only mode)", () => {
    const text = '[{"evidence":"from text","skip":"loud"}]';
    const result = parseDraft({ ok: true, code: 0, output: text });
    expect(result).toHaveLength(1);
    expect(result[0]!.skip).toBe("loud");
  });
});
