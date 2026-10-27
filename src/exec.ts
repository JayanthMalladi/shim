import { spawn, spawnSync } from "node:child_process";

export interface ExecResult {
  ok: boolean;
  code: number | null;
  output: string;
  ms: number;
}

/** Run a command without a shell. Output is truncated to the tail, which is where errors live. */
export function run(cmd: string, args: string[], cwd: string, timeoutMs = 10 * 60_000): ExecResult {
  const start = Date.now();
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? `\n${r.error.message}` : ""}`;
  return { ok: r.status === 0, code: r.status, output: output.slice(-8000), ms: Date.now() - start };
}

/** Async `run`, for work that runs side by side (parallel fixer candidates). */
export function runAsync(cmd: string, args: string[], cwd: string, timeoutMs = 10 * 60_000): Promise<ExecResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, CI: "1", FORCE_COLOR: "0" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const keep = (d: Buffer) => { output = (output + d.toString()).slice(-64_000); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => { output += `\n${e.message}`; });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, output: output.slice(-8000), ms: Date.now() - start });
    });
  });
}
