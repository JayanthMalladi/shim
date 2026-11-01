import crossSpawn from "cross-spawn";

/**
 * The environment split is a security boundary, not a convenience: target-repo code is untrusted,
 * and its install, build, test and gate scripts run with whatever environment we hand them. So
 * commands that execute target code get targetEnv() (no keys, tokens or credentials, and pnpm's
 * verify-deps-before-run check off, since it can run a full install with lifecycle scripts), and
 * only Shim's own headless `claude` runs get agentEnv() (the full environment, so claude's
 * authentication keeps working).
 */
const SECRET_RE = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i;
/**
 * Open-source providers that ship models via an OpenAI-compatible endpoint usually use
 * OPENAI_API_KEY (or OPENROUTER_API_KEY, etc.) — add that prefix here so target commands
 * never see it. Extendable at runtime via SHIM_SECRET_PREFIXES.
 */
const SECRET_PREFIXES = ["ANTHROPIC_", "CLAUDE_", "AWS_", "GH_", "GITHUB_", "OPENAI_"];
/**
 * Additional key prefixes to strip, comma-separated (e.g. "OPENROUTER_,GROQ_"). Merged with
 * SECRET_PREFIXES at targetEnv() time.
 */
const EXTENDED_SECRET_PREFIXES = (process.env.SHIM_SECRET_PREFIXES ?? "").split(",").map((p) => p.trim()).filter(Boolean);
const SECRET_NAMES = new Set(["NPM_TOKEN", "NODE_AUTH_TOKEN"]);
/**
 * Environment essentials that survive the secret strip. Matched case-insensitively, so the
 * lower-case forms of proxy and config variables are kept too.
 */
const KEEP_NAMES = new Set([
  "PATH", "HOME", "USERPROFILE", "CI", "FORCE_COLOR", "NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN",
  "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY",
]);

/** Environment for commands that run target-repo code: no API keys, tokens or credentials. */
export function targetEnv(): NodeJS.ProcessEnv {
  const prefixes = [...SECRET_PREFIXES, ...EXTENDED_SECRET_PREFIXES];
  const secret = (up: string) =>
    SECRET_RE.test(up) || SECRET_NAMES.has(up) || prefixes.some((p) => up.startsWith(p));
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    const up = k.toUpperCase();
    if (KEEP_NAMES.has(up) || !secret(up)) env[k] = v;
  }
  env.CI = "1";
  env.FORCE_COLOR = "0";
  env.npm_config_verify_deps_before_run = "false";
  return env;
}

/** Environment for Shim's own headless `claude` runs: the full process environment. */
export function agentEnv(): NodeJS.ProcessEnv {
  return { ...process.env, CI: "1", FORCE_COLOR: "0" };
}

export interface ExecResult {
  ok: boolean;
  code: number | null;
  output: string;
  ms: number;
  /** For `claude -p --output-format json`: the run's cost and its final text. */
  cost?: number;
  text?: string;
  /**
   * Per-test outcome for vitest/jest test gates: test id (relative file + full test name) -> passed?.
   * Only present when the gate's runner could be detected and its JSON report parsed; lets
   * regressions() catch a test that passed at baseline now failing or going missing even when
   * the gate as a whole was already red.
   */
  perTest?: Record<string, boolean>;
}

/**
 * The configured agent backend: `claude-cli` (default, today's runClaude) or `dsh`
 * (runs `dsh --profile headless "<prompt>"`; requires SHIM_SANDBOX=1).
 */
export type AgentBackend = "claude-cli" | "dsh";

export function agentBackend(): AgentBackend {
  const b = (process.env.SHIM_AGENT_BACKEND ?? "claude-cli").toLowerCase();
  if (b !== "claude-cli" && b !== "dsh")
    throw new Error(`unknown SHIM_AGENT_BACKEND: ${b}; expected "claude-cli" or "dsh"`);
  return b;
}

/**
 * True when cost is not a meaningful number: the `dsh` backend (no per-run cost report) or an
 * `ANTHROPIC_BASE_URL`-routed provider (its pricing is on the provider's dashboard, not in the
 * CLI's `total_cost_usd`). Callers should record cost as `null` ("unpriced") instead.
 */
export function costUnpriced(): boolean {
  return agentBackend() === "dsh" || !!process.env.ANTHROPIC_BASE_URL;
}

/**
 * The `dsh` backend: runs `dsh --profile headless "<prompt>"` in the repo dir and takes stdout as
 * the final text. Because dsh has no per-command allowlist or turn cap, it must only be used inside
 * a throwaway container or VM with no credentials in the environment: the call refuses to start
 * unless `SHIM_SANDBOX=1` is set. The timeout is enforced via `runAsync`.
 */
export async function runDsh(prompt: string, cwd: string, timeoutMs: number): Promise<ExecResult> {
  if (process.env.SHIM_SANDBOX !== "1")
    throw new Error(
      "the dsh agent backend refuses to start without SHIM_SANDBOX=1: dsh has no per-command allowlist or turn cap, " +
      "so it may only run inside a throwaway container or VM with no credentials in the environment " +
      "(SHIM_SANDBOX=1 is the only guard — set it in that context, not on a host machine)",
    );
  const res = await runAsync("dsh", ["--profile", "headless", prompt], cwd, timeoutMs, agentEnv());
  return { ...res, text: res.output };
}

/**
 * Run a command without a shell. Output is truncated to the tail, which is where errors live.
 * The env defaults to the target-safe one, so a call that forgets to think about it still can't
 * leak a key; pass env explicitly for the rare command that needs something unusual.
 */
/**
 * Spawn via cross-spawn: on Windows `npx`/`npm`/`pnpm` are .cmd shims that node:child_process
 * cannot resolve, so the pipeline's shell-outs ENOENT there. On Linux and macOS it is a thin
 * wrapper over node:child_process.
 */
export function run(cmd: string, args: string[], cwd: string, timeoutMs = 10 * 60_000, env: NodeJS.ProcessEnv = targetEnv()): ExecResult {
  const start = Date.now();
  const r = crossSpawn.sync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env,
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? `\n${r.error.message}` : ""}`;
  return { ok: r.status === 0, code: r.status, output: output.slice(-8000), ms: Date.now() - start };
}

/** Run with `input` on stdin and return all of stdout: `run` keeps only the tail, which can't be compared to a file. */
export function runCapture(cmd: string, args: string[], cwd: string, input?: string, env: NodeJS.ProcessEnv = targetEnv()): { ok: boolean; stdout: string } {
  const r = crossSpawn.sync(cmd, args, { cwd, encoding: "utf8", input, timeout: 5 * 60_000, maxBuffer: 64 * 1024 * 1024, env });
  return { ok: r.status === 0, stdout: r.stdout ?? "" };
}

/** Async `run`, for work that runs side by side (parallel fixer candidates). */
export function runAsync(cmd: string, args: string[], cwd: string, timeoutMs = 10 * 60_000, env: NodeJS.ProcessEnv = targetEnv()): Promise<ExecResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = crossSpawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const keep = (d: Buffer) => { output = (output + d.toString()).slice(-2_000_000); };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => { output += `\n${e.message}`; });
    child.on("close", (code) => {
      clearTimeout(timer);
      const json = parseAgentJson(output);
      resolve({ ok: code === 0, code, output: output.slice(-8000), ms: Date.now() - start, cost: json?.total_cost_usd, text: json?.result });
    });
  });
}

function parseAgentJson(output: string): { total_cost_usd?: number; result?: string } | undefined {
  for (const line of output.trim().split("\n").reverse()) {
    if (!line.startsWith("{") || !line.includes('"total_cost_usd"')) continue;
    try {
      return JSON.parse(line);
    } catch {}
  }
  return undefined;
}

const LIMIT = /hit your (session|usage|weekly|5-hour|daily) limit|usage limit reached|rate_limit_error|overloaded_error/i;

/**
 * `claude -p` that waits out a plan usage limit instead of failing: on "You've hit your session limit ·
 * resets 10pm (UTC)" it sleeps until the reset, then runs the same command again.
 */
export async function runClaude(args: string[], cwd: string, timeoutMs: number): Promise<ExecResult> {
  // The agent runs with the full environment so claude's auth (ANTHROPIC_API_KEY, a login profile,
  // or ANTHROPIC_AUTH_TOKEN) works; every other command defaulting to runAsync is target-safe.
  for (let tries = 0; ; tries++) {
    const res = await runAsync("claude", args, cwd, timeoutMs, agentEnv());
    const text = res.text ?? res.output;
    if (!LIMIT.test(text) || tries >= 6) return res;
    const wait = Math.min(msUntilReset(text) ?? 15 * 60_000, 6 * 3600_000);
    console.error(`[shim] usage limit hit; waiting ${Math.round(wait / 60_000)} min (${text.trim().slice(0, 120)})`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

/** "resets 10pm (UTC)" or "resets 3:30am (UTC)" -> ms until then, plus two minutes of slack. */
export function msUntilReset(text: string, now = new Date()): number | undefined {
  const m = text.match(/resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return undefined;
  let hour = Number(m[1]) % 12;
  if (m[3]!.toLowerCase() === "pm") hour += 12;
  const reset = new Date(now);
  reset.setUTCHours(hour, Number(m[2] ?? 0), 0, 0);
  if (reset.getTime() <= now.getTime()) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset.getTime() - now.getTime() + 2 * 60_000;
}

/**
 * Run a prompt on the configured agent backend, returning the same ExecResult shape either way.
 * The claude-cli backend keeps its model/turn/tools flags (shared by agent.ts and evolve.ts);
 * the dsh backend just takes the prompt.
 */
export async function runAgentBackend(args: string[], dir: string, timeoutMs: number, prompt: string): Promise<ExecResult> {
  if (agentBackend() === "dsh") return runDsh(prompt, dir, timeoutMs);
  return runClaude(args, dir, timeoutMs);
}
