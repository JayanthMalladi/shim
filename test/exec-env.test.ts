import { describe, expect, it } from "vitest";
import { agentEnv, run, targetEnv } from "../src/exec.js";

/** Set a handful of key-shaped variables for the duration of a test, and restore the original values. */
function withSecrets(fn: (set: () => void) => void) {
  const names = ["ANTHROPIC_API_KEY", "GITHUB_TOKEN", "FOO_SECRET", "MY_API_KEY", "AWS_SECRET_ACCESS_KEY", "CLAUDE_PROJECT_DIR", "NPM_TOKEN"] as const;
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]])) as Record<string, string | undefined>;
  const set = () => {
    for (const n of names) process.env[n] = `value-of-${n}`;
  };
  set();
  try {
    fn(set);
  } finally {
    for (const n of names) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  }
}

describe("targetEnv (environment for target-repo commands)", () => {
  it("drops API keys, tokens and credentials; keeps PATH and proxy variables", () => {
    withSecrets(() => {
      const env = targetEnv();
      for (const dropped of ["ANTHROPIC_API_KEY", "GITHUB_TOKEN", "FOO_SECRET", "MY_API_KEY", "AWS_SECRET_ACCESS_KEY", "CLAUDE_PROJECT_DIR", "NPM_TOKEN", "NODE_AUTH_TOKEN"])
        expect(dropped in env).toBe(false);
      expect(env.PATH).toBeDefined();
      expect(env.CI).toBe("1");
      expect(env.FORCE_COLOR).toBe("0");
      expect(env.npm_config_verify_deps_before_run).toBe("false");
      if (process.env.HTTPS_PROXY) expect(env.HTTPS_PROXY).toBe(process.env.HTTPS_PROXY);
    });
  });

  it("keeps lowercase proxy forms case-insensitively", () => {
    withSecrets(() => {
      process.env.https_proxy = "http://proxy.local";
      try {
        expect(targetEnv().https_proxy).toBe("http://proxy.local");
      } finally {
        delete process.env.https_proxy;
      }
    });
  });

  it("strips the whole GIT_CONFIG_* family together (COUNT + KEY_n + VALUE_n)", () => {
    // Cause: GIT_CONFIG_VALUE_n can carry auth headers (e.g. http.<host>.extraheader with a token).
    // If we drop KEY_n/VALUE_n but keep GIT_CONFIG_COUNT, git fails with
    // "missing config key GIT_CONFIG_KEY_0". Strip all three as one family.
    const saved = {
      COUNT: process.env.GIT_CONFIG_COUNT,
      KEY_0: process.env.GIT_CONFIG_KEY_0,
      VALUE_0: process.env.GIT_CONFIG_VALUE_0,
    };
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "core.autocrlf";
    process.env.GIT_CONFIG_VALUE_0 = "false";
    try {
      const env = targetEnv();
      expect(env.GIT_CONFIG_COUNT).toBeUndefined();
      expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
      expect(env.GIT_CONFIG_VALUE_0).toBeUndefined();
      // And a target command still succeeds (no missing-config-key failure).
      const r = run("git", ["--version"], process.cwd(), 30_000);
      expect(r.ok).toBe(true);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe("agentEnv (environment for Shim's own claude runs)", () => {
  it("keeps the keys claude authenticates with", () => {
    withSecrets(() => {
      const env = agentEnv();
      expect(env.ANTHROPIC_API_KEY).toBe("value-of-ANTHROPIC_API_KEY");
      expect(env.PATH).toBeDefined();
    });
  });
});

describe("run() leaks no secrets into target commands", () => {
  it("a target command cannot read ANTHROPIC_API_KEY even when the parent has it", () => {
    withSecrets(() => {
      const probe = "console.log(process.env.ANTHROPIC_API_KEY ?? 'unset')";
      expect(run("node", ["-e", probe], process.cwd(), 30_000).output.trim()).toBe("unset");
      // ...but Shim's own claude environment can read it.
      expect(run("node", ["-e", probe], process.cwd(), 30_000, agentEnv()).output.trim()).toBe("value-of-ANTHROPIC_API_KEY");
    });
  });
});
