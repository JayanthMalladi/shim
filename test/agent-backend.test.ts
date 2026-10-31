import { describe, expect, it, vi } from "vitest";
import { agentBackend, costUnpriced, runDsh } from "../src/exec.js";
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
  it("throws when SHIM_JUDGE_MODEL is set but empty", () => {
    return withEnv("SHIM_JUDGE_MODEL", "", () => {
      expect(() => judgeModel()).toThrowError(/SHIM_JUDGE_MODEL is set but empty/);
    });
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
