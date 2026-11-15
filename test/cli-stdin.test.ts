/**
 * Unit tests for the stdio fix in runAsync (src/exec.ts).
 *
 * The reporter script is invoked directly via `node <script>` (bypassing PATH) through
 * runAsync. A state file records what the child saw on stdin and in argv.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runAsync } from "../src/exec.js";

const SCRIPT = `
const fs = require('fs');
const sf = process.argv[2];
let stdinBytes = 0;
process.stdin.on('data', (d) => { stdinBytes += Buffer.byteLength(d); });
process.stdin.on('end', () => {
  try { fs.writeFileSync(sf, JSON.stringify({argv: process.argv.slice(2), stdinBytes})); } catch (e) {}
  process.exit(0);
});
setTimeout(() => {
  try { fs.writeFileSync(sf, JSON.stringify({argv: process.argv.slice(2), stdinBytes, reason:'timeout'})); } catch (e) {}
  process.exit(0);
}, 5000);
`;

describe("runAsync stdio fix", () => {
  it("pipes stdin when provided — child gets exact bytes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-async-"));
    try {
      const script = path.join(dir, "reporter.js");
      const stateFile = path.join(dir, "state.json");
      fs.writeFileSync(script, SCRIPT, "utf8");

      const prompt = "x".repeat(200);
      // runAsync(process.execPath, [script, stateFile, "--test"], ..., prompt)
      // => child sees: argv = [script, stateFile, "--test"], stdin = 200 bytes
      const res = await runAsync(
        process.execPath,
        [script, stateFile, "--test"],
        process.cwd(),
        15_000,
        undefined,
        prompt
      );
      expect(res.ok).toBe(true);
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      expect(state.argv).toEqual([stateFile, "--test"]);
      expect(state.stdinBytes).toBe(200);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);

  it("ignores stdin when omitted — child sees 0 bytes, no hang", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-async-"));
    try {
      const script = path.join(dir, "reporter.js");
      const stateFile = path.join(dir, "state.json");
      fs.writeFileSync(script, SCRIPT, "utf8");

      // No stdin param: runAsync should use ["ignore","pipe","pipe"]
      const res = await runAsync(
        process.execPath,
        [script, stateFile, "--test"],
        process.cwd(),
        10_000,
        undefined,
        undefined
      );
      expect(res.ok).toBe(true);
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      expect(state.argv).toEqual([stateFile, "--test"]);
      expect(state.stdinBytes).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
