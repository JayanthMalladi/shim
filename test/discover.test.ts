import { afterEach, describe, expect, it, vi } from "vitest";
import { discover } from "../src/discover.js";
import { AI_SDK_V7, ZOD_V4 } from "../src/migrations.js";

const recent = new Date(Date.now() - 5 * 86_400_000).toISOString();
const older = new Date(Date.now() - 10 * 86_400_000).toISOString();
const stale = new Date(Date.now() - 200 * 86_400_000).toISOString();

/** A registry document whose latest version has `manifest` (repo and test script filled in unless overridden). */
function doc(name: string, manifest: Record<string, unknown>, published = recent) {
  return {
    "dist-tags": { latest: "1.0.0" },
    time: { "1.0.0": published },
    versions: { "1.0.0": { name, repository: `git+https://github.com/acme/${name}.git`, scripts: { test: "vitest run" }, ...manifest } },
  };
}

/** Stub fetch: every search returns all names; each package URL returns its doc. */
function stubRegistry(docs: Record<string, object>) {
  vi.stubGlobal("fetch", async (url: string) => {
    const body = url.includes("/-/v1/search")
      ? { objects: Object.keys(docs).map((name) => ({ package: { name } })) }
      : docs[decodeURIComponent(url.split("/").pop()!)];
    return { ok: !!body, status: body ? 200 : 404, headers: new Headers(), json: async () => body };
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("discover, Zod", () => {
  it("keeps zod 3 packages with tests and a GitHub repo, CLIs first", async () => {
    stubRegistry({
      "app-dep": doc("app-dep", { dependencies: { zod: "^3.22.4" } }, recent),
      "app-dev": doc("app-dev", { devDependencies: { zod: "3.25.76" } }, older),
      "cli-old": doc("cli-old", { dependencies: { zod: "^3.23.0" }, bin: { x: "cli.js" } }, older),
      "peer-lib": doc("peer-lib", { dependencies: { zod: "^3.22.0" }, peerDependencies: { zod: "^3.22.0" } }),
      "on-four": doc("on-four", { dependencies: { zod: "^4.1.0" } }),
      "dual": doc("dual", { dependencies: { zod: "^3.25.0 || ^4.0.0" } }),
      "no-tests": doc("no-tests", { dependencies: { zod: "^3.22.0" }, scripts: {} }),
      "npm-default-test": doc("npm-default-test", { dependencies: { zod: "^3.22.0" }, scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
      "no-repo": doc("no-repo", { dependencies: { zod: "^3.22.0" }, repository: undefined }),
      "stale": doc("stale", { dependencies: { zod: "^3.22.0" } }, stale),
      "codemod-tool": doc("codemod-tool", { dependencies: { zod: "^3.22.0" }, keywords: ["zod", "codemod"] }),
      "json-schema-gen": doc("json-schema-gen", { dependencies: { zod: "^3.22.0" }, devDependencies: { "zod-to-json-schema": "^3.25.2" } }),
    });
    const found = await discover(60, 1, ZOD_V4);
    expect(found.map((c) => [c.name, c.aiRange, c.bin])).toEqual([
      ["cli-old", "^3.23.0", true],
      ["app-dep", "^3.22.4", false],
      ["app-dev", "3.25.76", false],
    ]);
  });
});

describe("discover, AI SDK", () => {
  it("returns the same fields as before, without bin", async () => {
    stubRegistry({
      "ai-app": doc("ai-app", { dependencies: { ai: "^6.0.0" } }),
      "ai-new": doc("ai-new", { dependencies: { ai: "^7.0.0" } }),
    });
    const found = await discover(60, 1, AI_SDK_V7);
    expect(found).toEqual([{ name: "ai-app", version: "1.0.0", aiRange: "^6.0.0", repo: "acme/ai-app", published: recent }]);
  });
});
