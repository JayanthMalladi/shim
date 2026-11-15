import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { agentBackend, costUnpriced, runDsh, runClaude } from "../src/exec.js";
import { judgeModel } from "../src/agent.js";

function withEnv(name: string, value: string | undefined, fn: () => void | Promise<void>) {
  const saved = process.env[name];
  if (name === "PATH") {
    // Prepend to existing PATH so node.exe remains available.
    process.env.PATH = value + path.delimiter + (saved ?? process.env.PATH ?? "");
  } else if (value === undefined) delete process.env[name];
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

/**
 * Fake `claude` that records argv and stdin byte count to a state file, then exits 0.
 * Both `claude.cmd` (Windows) and `claude` (Git Bash) shims are written so cross-spawn
 * resolves it regardless of shell. The fake dir is prepended to PATH inside the test.
 */
function writeFakeClaude(dir: string): string {
  const jsPath = path.join(dir, "fake-claude.js");
  const stateFile = path.join(dir, "state.json");
  const script = [
    `const sf = ${JSON.stringify(stateFile)};`,
    "const fs = require('fs');",
    "let stdinBytes = 0;",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (d) => { stdinBytes += Buffer.byteLength(d); });",
    "process.stdin.on('end', () => {",
    "  try { fs.writeFileSync(sf, JSON.stringify({argv: process.argv.slice(2), stdinBytes})); } catch (e) {}",
    "  process.exit(0);",
    "});",
    // Fallback exit so the process can't hang.
    "setTimeout(() => {",
    "  try { fs.writeFileSync(sf, JSON.stringify({argv: process.argv.slice(2), stdinBytes, reason: 'timeout'})); } catch (e) {}",
    "  process.exit(0);",
    "}, 5000);",
  ].join("\n");
  fs.writeFileSync(jsPath, script, "utf8");

  // Windows .cmd shim
  fs.writeFileSync(
    path.join(dir, "claude.cmd"),
    '@echo off\r\nnode "' + jsPath.replace(/"/g, '\\"') + '" %*',
    "utf8"
  );
  // Git Bash / MSYS shim
  fs.writeFileSync(
    path.join(dir, "claude"),
    "#!/bin/sh\nexec node \"" + jsPath.replace(/"/g, '\\"') + "\" \"$@\"\n",
    { mode: 0o755 }
  );

  return dir;
}

describe("runClaude: prompt piped via stdin, not argv", () => {
  it("a 40000-char prompt arrives on stdin with exactly 40000 bytes, not in argv, and -p is in argv", async () => {
    const fakeDir = writeFakeClaude(fs.mkdtempSync(path.join(os.tmpdir(), "shim-fake-claude-")));
    const stateFile = path.join(fakeDir, "state.json");
    try {
      const prompt = "x".repeat(40000);
      await withEnv("PATH", fakeDir, async () => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("runClaude timed out")), 20_000);
          import("../src/exec.js").then(({ runClaude }) => {
            runClaude(["-p", "--model", "test", "--output-format", "json"], process.cwd(), 60_000, prompt)
              .then(() => {
                clearTimeout(timer);
                const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
                expect(state.argv).not.toContain(prompt);
                expect(state.argv).toContain("-p");
                expect(state.stdinBytes).toBe(40000);
                resolve();
              })
              .catch((e) => { clearTimeout(timer); reject(e); });
          }).catch(reject);
        });
      });
    } finally {
      fs.rmSync(fakeDir, { recursive: true, force: true });
    }
  }, 30000);

  it("a short prompt also arrives on stdin, not in argv", async () => {
    const fakeDir = writeFakeClaude(fs.mkdtempSync(path.join(os.tmpdir(), "shim-fake-claude-")));
    const stateFile = path.join(fakeDir, "state.json");
    try {
      const prompt = "hello";
      await withEnv("PATH", fakeDir, async () => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("runClaude timed out")), 20_000);
          import("../src/exec.js").then(({ runClaude }) => {
            runClaude(["-p", "--model", "test"], process.cwd(), 60_000, prompt)
              .then(() => {
                clearTimeout(timer);
                const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
                expect(state.argv).not.toContain(prompt);
                expect(state.argv).toContain("-p");
                expect(state.stdinBytes).toBe(prompt.length);
                resolve();
              })
              .catch((e) => { clearTimeout(timer); reject(e); });
          }).catch(reject);
        });
      });
    } finally {
      fs.rmSync(fakeDir, { recursive: true, force: true });
    }
  }, 30000);
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

describe("env model overrides (arch.ts seed defaults)", () => {
  it("SHIM_FIXER_MODEL/SHIM_REVIEWER_MODEL override V1/DEFAULT_ARCH when set before import", async () => {
    vi.resetModules();
    process.env.SHIM_FIXER_MODEL = "my-custom-fix-model";
    process.env.SHIM_REVIEWER_MODEL = "my-custom-review-model";
    try {
      const { V1, DEFAULT_ARCH } = await import("../src/arch.js");
      expect(V1.fixerModel).toBe("my-custom-fix-model");
      expect(V1.reviewerModel).toBe("my-custom-review-model");
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
