import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentBackend, costUnpriced, runDsh, runAgentBackend } from "../src/exec.js";
import { judgeModel } from "../src/agent.js";

/** Temporarily set an env var and restore it (or delete it) afterwards. */
function withEnv(name: string, value: string | undefined, fn: () => void | Promise<void>) {
  const saved = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  const restore = () => {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  };
  const p: Promise<void> | void = fn();
  return p instanceof Promise ? p.finally(restore) : (restore(), p);
}

describe("agentBackend()", () => {
  it("defaults to claude-cli when SHIM_AGENT_BACKEND is unset", () => {
    return withEnv("SHIM_AGENT_BACKEND", undefined, () => {
      expect(agentBackend()).toBe("claude-cli");
    });
  });
  it("returns dsh when SHIM_AGENT_BACKEND=dsh", () => {
    return withEnv("SHIM_AGENT_BACKEND", "dsh", () => {
      expect(agentBackend()).toBe("dsh");
    });
  });
  it("throws on an unknown backend", () => {
    return withEnv("SHIM_AGENT_BACKEND", "bogus", () => {
      expect(() => agentBackend()).toThrowError(/unknown SHIM_AGENT_BACKEND/);
    });
  });
});

describe("runDsh", () => {
  it("refuses to start without SHIM_SANDBOX=1", () => {
    return withEnv("SHIM_AGENT_BACKEND", "dsh", () =>
      withEnv("SHIM_SANDBOX", undefined, async () => {
        await expect(runDsh("prompt", process.cwd(), 1000)).rejects.toThrowError(/SHIM_SANDBOX=1/);
      })
    );
  });
  it("throws a clear error when SHIM_AGENT_BACKEND is an unknown value", () => {
    return withEnv("SHIM_AGENT_BACKEND", "xyz", () => {
      expect(() => agentBackend()).toThrowError(/unknown SHIM_AGENT_BACKEND/);
    });
  });
});

describe("costUnpriced()", () => {
  it("is false for the claude-cli backend with no ANTHROPIC_BASE_URL", () => {
    return withEnv("SHIM_AGENT_BACKEND", undefined, () =>
      withEnv("ANTHROPIC_BASE_URL", undefined, () => {
        expect(costUnpriced()).toBe(false);
      })
    );
  });
  it("is true when ANTHROPIC_BASE_URL is set (claude-cli backend)", () => {
    return withEnv("SHIM_AGENT_BACKEND", undefined, () =>
      withEnv("ANTHROPIC_BASE_URL", "https://example.com/v1", () => {
        expect(costUnpriced()).toBe(true);
      })
    );
  });
  it("is true when the backend is dsh (regardless of ANTHROPIC_BASE_URL)", () => {
    return withEnv("SHIM_AGENT_BACKEND", "dsh", () =>
      withEnv("ANTHROPIC_BASE_URL", undefined, () => {
        expect(costUnpriced()).toBe(true);
      })
    );
  });
});

describe("judgeModel()", () => {
  it("falls back to the hard-coded opus when SHIM_JUDGE_MODEL is unset", () => {
    return withEnv("SHIM_JUDGE_MODEL", undefined, () => {
      expect(judgeModel()).toBe("claude-opus-5-5");
    });
  });
  it("uses the value of SHIM_JUDGE_MODEL when set", () => {
    return withEnv("SHIM_JUDGE_MODEL", "custom-model-id", () => {
      expect(judgeModel()).toBe("custom-model-id");
    });
  });
  it("falls back to the hard-coded opus when SHIM_JUDGE_MODEL is set but empty", () => {
    return withEnv("SHIM_JUDGE_MODEL", "", () => {
      expect(judgeModel()).toBe("claude-opus-5-5");
    });
  });
});

/**
 * A fake `claude` on PATH that records its argv and its stdin to files in its OWN directory
 * (never the cwd, so it leaves no untracked files in the repo dir the run happens in). Mirrors the
 * fake-`dsh` mechanism in agent-reviewer-guard.test.ts, adapted for the claude-cli backend: it
 * prints a minimal `claude -p --output-format json` envelope to stdout so the caller's JSON parse
 * succeeds. On Windows `claude` resolves to a .cmd batch file that cross-spawn runs directly.
 */

describe("runAgentBackend keeps the prompt off argv (Windows CreateProcess ~32 KB cap)", () => {
  let fakeDir: string;
  let runDir: string;
  const savedEnv: Record<string, string | undefined> = {};
  const savedBackend = process.env.SHIM_AGENT_BACKEND;

  function writeFakeClaude() {
    // A node-based fake is far more reliable than batch/sh: it records the exact argv it was
    // spawned with (process.argv.slice(2)) and the exact stdin byte count, both to files in its
    // own dir. cross-spawn resolves "claude" to the platform wrapper below, which execs node.
    const fakeJs = [
      'const fs = require("fs");',
      'const dir = __dirname;',
      'fs.writeFileSync(dir + "/argv.txt", JSON.stringify(process.argv.slice(2)));',
      'const stdinBuf = fs.readFileSync(0); // read the whole piped stdin',
      'fs.writeFileSync(dir + "/stdin-len.txt", String(stdinBuf.length));',
      'console.log(\'{"total_cost_usd":0.0,"result":"ok","is_error":false,"type":"result"}\');',
    ].join("\n") + "\n";
    fs.writeFileSync(path.join(fakeDir, "fake-claude.js"), fakeJs);
    if (process.platform === "win32") {
      // cross-spawn on Windows runs .cmd directly (no cmd /c wrapper); %* forwards all args to node.
      fs.writeFileSync(path.join(fakeDir, "claude.cmd"), "@ECHO OFF\r\nnode \"%~dp0fake-claude.js\" %*\r\n");
    } else {
      fs.writeFileSync(path.join(fakeDir, "claude"), '#!/bin/sh\nexec node "$(dirname "$0")/fake-claude.js" "$@"\n', { mode: 0o755 });
    }
  }

  beforeEach(() => {
    fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-fake-claude-"));
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-agent-run-"));
    for (const k of ["PATH", "SHIM_AGENT_BACKEND"] as const) savedEnv[k] = process.env[k];
    process.env.PATH = `${fakeDir}${path.delimiter}${process.env.PATH ?? ""}`;
    process.env.SHIM_AGENT_BACKEND = "claude-cli";
  });
  afterEach(() => {
    for (const k of ["SHIM_AGENT_BACKEND"]) process.env[k] = savedBackend;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(fakeDir, { recursive: true, force: true });
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  /** The fake records argv as JSON; parse it back for assertions. */
  const argvOf = (): string[] => JSON.parse(fs.readFileSync(path.join(fakeDir, "argv.txt"), "utf8"));
  const stdinLenOf = (): number => Number(fs.readFileSync(path.join(fakeDir, "stdin-len.txt"), "utf8").trim());

  it("pipes a large prompt on stdin, not argv: the prompt's bytes land in stdin, argv holds no prompt", async () => {
    writeFakeClaude();
    const prompt = "e".repeat(40_000); // > the 32,767-char CreateProcess cap; would ENAMETOOLONG in argv
    // The shape every real call site builds: "-p", prompt, then flags. runAgentBackend must strip
    // the -p <prompt> pair and pipe the prompt on stdin instead.
    const args = ["-p", prompt, "--model", "claude-sonnet-5-5", "--max-turns", "30", "--output-format", "json"];
    const res = await runAgentBackend(args, runDir, 30_000, prompt);
    expect(res.ok).toBe(true);
    // The prompt must NOT be on the command line: the "-p" flag stays, the positional prompt is
    // gone, the other flags are intact.
    const argv = argvOf();
    expect(argv).toContain("-p");
    expect(argv).not.toContain(prompt);
    expect(argv).toContain("--model");
    expect(argv).toContain("claude-sonnet-5-5");
    // The prompt's bytes must have arrived on stdin: exact byte count == prompt length.
    expect(stdinLenOf()).toBe(prompt.length);
  });

  it("still works for a short prompt (the common case): -p pair stripped, prompt piped, flags kept", async () => {
    writeFakeClaude();
    const args = ["-p", "say ok", "--model", "claude-sonnet-5-5", "--output-format", "json"];
    const res = await runAgentBackend(args, runDir, 30_000, "say ok");
    expect(res.ok).toBe(true);
    const argv = argvOf();
    expect(argv).not.toContain("say ok");
    expect(argv).toContain("--output-format");
    expect(res.text).toBe("ok"); // the fake's JSON result parses to text
    expect(stdinLenOf()).toBe("say ok".length);
  });
});

describe("env model overrides (arch.ts seed defaults)", () => {
  it("SHIM_FIXER_MODEL/SHIM_REVIEWER_MODEL override V1/DEFAULT_ARCH when set before import", async () => {
    // arch.ts reads env vars at module load time. We must reset the module cache, set the env
    // vars, then dynamically import arch.js to get fresh module-level constants.
    vi.resetModules();
    process.env.SHIM_FIXER_MODEL = "my-custom-fix-model";
    process.env.SHIM_REVIEWER_MODEL = "my-custom-review-model";
    try {
      const { V1, DEFAULT_ARCH } = await import("../src/arch.js");
      expect(V1.fixerModel).toBe("my-custom-fix-model");
      expect(V1.reviewerModel).toBe("my-custom-review-model");
      // DEFAULT_ARCH (V2) spreads V1, so it inherits the overridden models.
      expect(DEFAULT_ARCH.fixerModel).toBe("my-custom-fix-model");
      expect(DEFAULT_ARCH.reviewerModel).toBe("my-custom-review-model");
    } finally {
      delete process.env.SHIM_FIXER_MODEL;
      delete process.env.SHIM_REVIEWER_MODEL;
      vi.resetModules();
    }
  });
  it("falls back to the hard-coded defaults when env vars are unset", async () => {
    vi.resetModules();
    delete process.env.SHIM_FIXER_MODEL;
    delete process.env.SHIM_REVIEWER_MODEL;
    try {
      const { V1 } = await import("../src/arch.js");
      expect(V1.fixerModel).toBe("claude-opus-5-5");
      expect(V1.reviewerModel).toBe("claude-opus-5-5");
    } finally {
      vi.resetModules();
    }
  });
});
