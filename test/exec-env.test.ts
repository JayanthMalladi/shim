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

/** Set SHIM_SECRET_PREFIXES for the duration of a test and restore it. */
function withShimSecretPrefixes(prefixes: string, fn: () => void) {
  const saved = process.env.SHIM_SECRET_PREFIXES;
  process.env.SHIM_SECRET_PREFIXES = prefixes;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.SHIM_SECRET_PREFIXES;
    else process.env.SHIM_SECRET_PREFIXES = saved;
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

  it("drops variables matching a prefix from SHIM_SECRET_PREFIXES", () => {
    // The test must set both the prefix AND the key variable; the prefix check happens at
    // module-load time in exec.ts, so we use a key whose prefix we control.
    process.env.MYPROVIDER_API_KEY = "sk-abc123";
    withShimSecretPrefixes("MYPROVIDER_", () => {
      const env = targetEnv();
      expect("MYPROVIDER_API_KEY" in env).toBe(false);
    });
    delete process.env.MYPROVIDER_API_KEY;
  });

  it("keeps variables that do not match any SHIM_SECRET_PREFIXES prefix", () => {
    process.env.MYPROVIDER_API_KEY = "sk-abc123";
    process.env.OTHER_PREFIX_VAR = "safe";
    withShimSecretPrefixes("MYPROVIDER_", () => {
      const env = targetEnv();
      expect("OTHER_PREFIX_VAR" in env).toBe(true);
    });
    delete process.env.MYPROVIDER_API_KEY;
    delete process.env.OTHER_PREFIX_VAR;
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
