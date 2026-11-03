import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentPreflight } from "../src/exec.js";
import { agentInfo } from "../src/pipeline.js";
import { DEFAULT_ARCH } from "../src/arch.js";

const VARS = ["PATH", "SHIM_AGENT_BACKEND", "SHIM_SANDBOX", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"];
let saved: Record<string, string | undefined>;
let bin: string;

/** A fake executable on an otherwise empty PATH, so the test controls what "is installed". */
function fakeBin(name: string) {
  const file = path.join(bin, name);
  fs.writeFileSync(file, "#!/bin/sh\necho 1.0.0\n");
  fs.chmodSync(file, 0o755);
}

beforeEach(() => {
  saved = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
  for (const v of VARS) delete process.env[v];
  bin = fs.mkdtempSync(path.join(os.tmpdir(), "shim-bin-"));
  process.env.PATH = bin;
});

afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

const models = { fixer: "fixer-model", reviewer: "reviewer-model", judge: "judge-model" };

describe.skipIf(process.platform === "win32")("agentPreflight()", () => {
  it("fails fast with a clear message when the claude CLI is missing", () => {
    expect(() => agentPreflight(models)).toThrowError(/claude CLI .*not found/);
    expect(() => agentPreflight(models)).toThrowError(/shim scan.*need no model/);
  });

  it("names the backend, the models and the auth source for claude-cli", () => {
    fakeBin("claude");
    expect(agentPreflight(models)).toBe(
      "agent: claude-cli, your Claude Code login (fixer fixer-model, reviewer reviewer-model, judge judge-model)",
    );
    process.env.ANTHROPIC_API_KEY = "sk-secret-value";
    const line = agentPreflight({ fixer: "f" });
    expect(line).toBe("agent: claude-cli, ANTHROPIC_API_KEY (fixer f)");
    expect(line).not.toContain("sk-secret-value");
  });

  it("shows only the host of ANTHROPIC_BASE_URL and marks cost unpriced", () => {
    fakeBin("claude");
    process.env.ANTHROPIC_BASE_URL = "https://user:pw@proxy.example.com/v1";
    const line = agentPreflight({ fixer: "f" });
    expect(line).toBe("agent: claude-cli, provider at proxy.example.com, cost unpriced (fixer f)");
    expect(line).not.toContain("pw");
  });

  it("dsh: requires SHIM_SANDBOX=1, then the dsh binary", () => {
    process.env.SHIM_AGENT_BACKEND = "dsh";
    expect(() => agentPreflight(models)).toThrowError(/SHIM_SANDBOX=1/);
    process.env.SHIM_SANDBOX = "1";
    expect(() => agentPreflight(models)).toThrowError(/dsh .*not found/);
    fakeBin("dsh");
    expect(agentPreflight(models)).toBe("agent: dsh, models set by your dsh profile, cost unpriced");
  });
});

describe("agentInfo()", () => {
  it("records the backend and the models a claude-cli run used", () => {
    const prev = process.env.SHIM_AGENT_BACKEND;
    delete process.env.SHIM_AGENT_BACKEND;
    try {
      expect(agentInfo({ ...DEFAULT_ARCH, fixerModel: "f", reviewerModel: "r", review: true })).toEqual({ backend: "claude-cli", fixerModel: "f", reviewerModel: "r" });
      expect(agentInfo({ ...DEFAULT_ARCH, fixerModel: "f", review: false })).toEqual({ backend: "claude-cli", fixerModel: "f" });
      process.env.SHIM_AGENT_BACKEND = "dsh";
      expect(agentInfo({ ...DEFAULT_ARCH, fixerModel: "f" })).toEqual({ backend: "dsh" });
    } finally {
      if (prev === undefined) delete process.env.SHIM_AGENT_BACKEND;
      else process.env.SHIM_AGENT_BACKEND = prev;
    }
  });
});
