import { spawnSync } from "node:child_process";

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
