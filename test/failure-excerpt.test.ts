import { describe, expect, it } from "vitest";
import { failureExcerpt, run } from "../src/exec.js";

/** node --test style TAP: `n` passing tests with one failure in the middle. */
function tap(n: number, failAt: number): string {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    if (i === failAt) out.push(`not ok ${i} - parses the config`, "  ---", "  error: 'Expected values to be strictly equal'", "  ...");
    else out.push(`ok ${i} - test number ${i}`, "  ---", `  duration_ms: 0.${i}`, "  ...");
  }
  out.push(`# tests ${n}`, "# fail 1");
  return out.join("\n");
}

describe("failureExcerpt", () => {
  it("keeps a failure that a plain tail would cut off", () => {
    const full = tap(3000, 1500);
    expect(full.slice(-8000)).not.toContain("not ok 1500");
    const ex = failureExcerpt(full);
    expect(ex.length).toBeLessThanOrEqual(8000);
    expect(ex).toContain("not ok 1500 - parses the config");
    expect(ex).toContain("Expected values to be strictly equal");
    expect(ex).toContain("# fail 1");
  });

  it("returns short output unchanged", () => {
    expect(failureExcerpt("not ok 1 - x\nboom")).toBe("not ok 1 - x\nboom");
  });

  it("falls back to the tail when no failure line is found", () => {
    const full = "x".repeat(20000) + "TAIL";
    expect(failureExcerpt(full)).toBe(full.slice(-8000));
  });

  it("run() uses it for a failed command, and keeps the plain tail for a passing one", () => {
    // The script builds the same TAP text itself: passing it as an argument would exceed the OS limit.
    const script = (code: number) =>
      `const o=[];for(let i=1;i<=3000;i++){if(i===1500)o.push("not ok "+i+" - parses the config","  error: boom");` +
      `else o.push("ok "+i+" - test number "+i,"  duration_ms: 0."+i)}o.push("# fail 1");` +
      `process.stdout.write(o.join("\\n"));process.exit(${code})`;
    expect(run(process.execPath, ["-e", script(1)], process.cwd()).output).toContain("not ok 1500 - parses the config");
    expect(run(process.execPath, ["-e", script(0)], process.cwd()).output).not.toContain("not ok 1500");
  });
});
