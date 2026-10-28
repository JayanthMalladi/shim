import { spawn, spawnSync } from "node:child_process";

/**
 * CI mode, no color, and never let pnpm "fix" dependencies before a script: its verify-deps-before-run
 * check runs a full `pnpm install` with lifecycle scripts, which breaks our --ignore-scripts rule and fails
 * in copied repos whose install state records another path.
 */
const SAFE_ENV = { ...process.env, CI: "1", FORCE_COLOR: "0", npm_config_verify_deps_before_run: "false" };

export interface ExecResult {
  ok: boolean;
  code: number | null;
  output: string;
  ms: number;
  /** For `claude -p --output-format json`: the run's cost and its final text. */
  cost?: number;
  text?: string;
}

/** Run a command without a shell. Output is truncated to the tail, which is where errors live. */
export function run(cmd: string, args: string[], cwd: string, timeoutMs = 10 * 60_000): ExecResult {
  const start = Date.now();
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: SAFE_ENV,
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? `\n${r.error.message}` : ""}`;
  return { ok: r.status === 0, code: r.status, output: output.slice(-8000), ms: Date.now() - start };
}

/** Async `run`, for work that runs side by side (parallel fixer candidates). */
export function runAsync(cmd: string, args: string[], cwd: string, timeoutMs = 10 * 60_000): Promise<ExecResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: SAFE_ENV, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const keep = (d: Buffer) => { output = (output + d.toString()).slice(-2_000_000); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
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
  for (let tries = 0; ; tries++) {
    const res = await runAsync("claude", args, cwd, timeoutMs);
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
