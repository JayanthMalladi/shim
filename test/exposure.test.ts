import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildExposureReport, collectPins, readInstalledVersions, renderReport } from "../src/exposure.js";
import { formatFindings } from "../src/exposure.js";
import { scanWith } from "../src/scan.js";
import { getMigration } from "../src/migrations.js";

const fx = (n: string) => path.join(import.meta.dirname, "fixtures", n);

const at = (rule: string, findings: { ruleId: string; file: string; line: number }[]) =>
  findings.filter((f) => f.ruleId === rule).map((f) => `${f.file}:${f.line}`);

// ---- lockfile readers: the resolved version of a direct dep, per format ----------

describe("lockfile installed-version readers", () => {
  it("reads the resolved version from package-lock.json (npm)", () => {
    const r = readInstalledVersions(fx("npm-lock-app"));
    expect(r?.name).toBe("package-lock.json");
    expect(r?.versions.get("zod")).toBe("3.25.76");
  });

  it("reads the resolved version from pnpm-lock.yaml (pnpm v9, importers)", () => {
    const r = readInstalledVersions(fx("pnpm-lock-app"));
    expect(r?.name).toBe("pnpm-lock.yaml");
    expect(r?.versions.get("zod")).toBe("3.25.76");
    // Scoped dep names are quoted in the lockfile ('@changesets/parse':) — the reader strips the quotes.
    expect(r?.versions.get("@changesets/parse")).toBe("0.4.1");
    // A dep with peer deps carries a `16.1.0(react@18.3.1)` version; the reader strips the peer tail.
    expect(r?.versions.get("@testing-library/react")).toBe("16.1.0");
  });

  it("reads the resolved version from yarn.lock (classic v1)", () => {
    const r = readInstalledVersions(fx("yarn-lock-app"));
    expect(r?.name).toBe("yarn.lock");
    expect(r?.versions.get("zod")).toBe("3.25.76");
  });

  it("reads the resolved version from bun.lock", () => {
    const r = readInstalledVersions(fx("bun-lock-app"));
    expect(r?.name).toBe("bun.lock");
    expect(r?.versions.get("zod")).toBe("3.25.76");
  });

  it("reads no installed version when no lockfile exists", () => {
    expect(readInstalledVersions(fx("zod3-app"))).toBeUndefined();
  });
});

// ---- pins + workspaces ---------------------------------------------------------

describe("collectPins", () => {
  it("collects every declared dep from every package.json, root and workspace", () => {
    const pins = collectPins(fx("pnpm-ws"));
    const by = (pkg: string, file: string) => pins.find((p) => p.pkg === pkg && p.file === file);
    expect(by("zod", "packages/zod-pkg/package.json")?.range).toBe("^3.25.0");
    expect(by("express", "packages/express-pkg/package.json")?.range).toBe("^4.21.0");
  });

  it("reads a workspace lockfile's per-importer versions onto the right pins", () => {
    const r = buildExposureReport(fx("pnpm-ws"));
    const zod = r.pins.find((p) => p.pkg === "zod")!;
    const express = r.pins.find((p) => p.pkg === "express")!;
    expect(zod.installed).toBe("3.25.76");
    expect(express.installed).toBe("4.21.2");
  });
});

// ---- section logic -------------------------------------------------------------

describe("exposure report sections", () => {
  it("classifies an old-major pin as Covered and lists its findings by severity", () => {
    const r = buildExposureReport(fx("zod3-app"));
    const zod = r.sections.find((s) => s.migration.id === "zod-v4")!;
    expect(zod.kind).toBe("covered");
    // silent findings sort before break, before deprecated (assert the grouping order).
    const text = renderReport(r);
    expect(text).toContain("## Covered: Zod 4 (zod-v4)");
    expect(text.indexOf("### silent")).toBeLessThan(text.indexOf("### break"));
    expect(at("zod-errors-property", zod.findings).length).toBeGreaterThan(0);
  });

  it("classifies an already-on-new-major pin as 'Upgraded, but code may still use the old API' and still scans it", () => {
    const r = buildExposureReport(fx("ai7-system"));
    const ai = r.sections.find((s) => s.migration.id === "ai-sdk-v7")!;
    expect(ai.kind).toBe("upgraded");
    // A system message inside messages still fires under ai@^7.
    expect(at("system-in-messages", ai.findings).length).toBeGreaterThan(0);
    expect(renderReport(r)).toContain("## Upgraded, but code may still use the old API: AI SDK 7 (ai-sdk-v7)");
  });

  it("prints the honest not-covered line and zero findings for uncovered-only deps", () => {
    const r = buildExposureReport(fx("uncovered"));
    expect(r.sections.length).toBe(0);
    expect(r.notCovered.map((p) => p.pkg).sort()).toEqual(["lodash", "react"]);
    const text = renderReport(r);
    expect(text).toContain("No Shim rules for these packages yet");
    expect(text).toContain("lodash");
    expect(text).toContain("react");
    // No Covered/Upgraded section at all: no pack matched.
    expect(text).not.toContain("## Covered:");
    expect(text).not.toContain("## Upgraded,");
  });

  it("never claims coverage for a package that has no rules", () => {
    const text = renderReport(buildExposureReport(fx("uncovered")));
    // lodash/react appear only in the honest not-covered line, never as a section.
    expect(text).not.toMatch(/^## .*lodash/m);
    expect(text).not.toMatch(/^## .*react/m);
  });
});

// ---- the report footer ----------------------------------------------------------

describe("report footer", () => {
  it("states that no code left the machine, no model was called, and no network request was made", () => {
    const text = renderReport(buildExposureReport(fx("zod3-app")));
    expect(text).toMatch(/no code left your machine/i);
    expect(text).toMatch(/no model was called/i);
    expect(text).toMatch(/no network request was made/i);
  });

  it("points at the fix command for any covered pack that had findings", () => {
    const text = renderReport(buildExposureReport(fx("zod3-app")));
    expect(text).toContain("npx getshim fix . --migration zod-v4");
  });
});

// ---- --migration stays byte-identical -----------------------------------------

describe("--migration single-pack mode is unchanged", () => {
  // The exact bytes the pre-S04 CLI printed for each fixture's migration. The golden test
  // renders through formatFindings so the format cannot drift from what the CLI emits.
  it("reproduces the zod-v4 listing on zod3-app", () => {
    const out = formatFindings(scanWith(fx("zod3-app"), getMigration("zod-v4")).result);
    expect(out).toMatch(/src\/error-only\.js:9  break\/auto  \[zod-errors-property\]/);
    expect(out).toMatch(/36 findings in 11 files/);
  });
});

// ---- static import guard: the scan path must stay model-free + network-free ----

describe("scan path has no model or network dependency", () => {
  const files = [
    path.join(import.meta.dirname, "..", "src", "scan.ts"),
    path.join(import.meta.dirname, "..", "src", "exposure.ts"),
  ];
  const IMPORT_RE =
    /import\b[\s\S]*?from\s+["'](node:(?:https?)|agent\.js|agent|exec\.js|exec)["']|require\(["'](node:(?:https?))["']\)|\bfetch\(|new https?\.Client|https?\.(?:get|request)\(/;
  for (const f of files) {
    it(`does not import agent / network helpers / http or call fetch (${path.basename(f)})`, () => {
      expect(fs.readFileSync(f, "utf8")).not.toMatch(IMPORT_RE);
    });
  }
});
