// T14: on log-10x the judge came back "reviewer gave no verdict" with output "": claude's JSON had
// `"result": ""`, and `res.text ?? res.output` kept the empty string instead of the raw JSON.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runReviewer } from "../src/agent.js";
import { run } from "../src/exec.js";

const LINE = '{"type":"result","subtype":"success","is_error":false,"num_turns":50,"result":"","total_cost_usd":0}';

describe("reviewer with an empty final message", () => {
  let dir: string;
  let fakeDir: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-empty-result-"));
    run("git", ["init", "-q"], dir);
    fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-fake-claude-"));
    if (process.platform === "win32") fs.writeFileSync(path.join(fakeDir, "claude.cmd"), `@ECHO OFF\r\necho ${LINE}\r\n`);
    else fs.writeFileSync(path.join(fakeDir, "claude"), `#!/bin/sh\necho '${LINE}'\n`, { mode: 0o755 });
    for (const k of ["PATH", "SHIM_AGENT_BACKEND", "SHIM_REVIEWER_MODEL"]) saved[k] = process.env[k];
    process.env.PATH = `${fakeDir}${path.delimiter}${process.env.PATH ?? ""}`;
    delete process.env.SHIM_AGENT_BACKEND;
    process.env.SHIM_REVIEWER_MODEL = "claude-opus-4-5";
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fakeDir, { recursive: true, force: true });
  });

  it("keeps claude's raw JSON as the output, so the run shows why", async () => {
    const review = await runReviewer(dir);
    expect(review.issues).toEqual(["reviewer gave no verdict"]);
    expect(review.output).toContain('"num_turns":50');
  });
});
