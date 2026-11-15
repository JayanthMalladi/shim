import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prismaGenerateCmds, runPrismaGenerate, PRISMA_GENERATE_GATE, type PrismaGenCmd } from "../src/prisma.js";
import { runGates, regressions } from "../src/gates.js";

/** A temp repo with the prisma schema files a test wants; returns the dir. */
const mkPrismaRepo = (files: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-prisma-"));
  for (const [name, text] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return dir;
};

/** A package.json that depends on prisma (the CLI) so findPackages picks the dir up. */
const prismaPkg = (extra: object = {}) =>
  JSON.stringify({ name: "p", private: true, devDependencies: { prisma: "^5.0.0" }, ...extra });

/** The single safe generate command every positive case must produce. */
const expectOneCmd = (dir: string, relSchema: string) => {
  const { cmds, skipped } = prismaGenerateCmds(dir);
  expect(skipped).toEqual([]);
  expect(cmds).toEqual([{ args: ["--no-install", "prisma", "generate", "--schema", path.join(dir, relSchema)], cwd: dir }]);
};

describe("prismaGenerateCmds: safe generator providers", () => {
  it("prisma-client-js gives one command with the right --schema", () => {
    const dir = mkPrismaRepo({
      "package.json": prismaPkg(),
      "prisma/schema.prisma": 'datasource db { provider = "postgresql", url = env("DATABASE_URL") }\ngenerator client { provider = "prisma-client-js" }\nmodel A { id Int }\n',
    });
    expectOneCmd(dir, path.join("prisma", "schema.prisma"));
  });

  it("prisma-client (the new generator name) also runs", () => {
    const dir = mkPrismaRepo({
      "package.json": prismaPkg(),
      "prisma/schema.prisma": 'generator client { provider = "prisma-client" }\nmodel A { id Int }\n',
    });
    expectOneCmd(dir, path.join("prisma", "schema.prisma"));
  });

  it("a top-level schema.prisma (no prisma/ folder) is found", () => {
    const dir = mkPrismaRepo({
      "package.json": prismaPkg(),
      "schema.prisma": 'generator client { provider = "prisma-client-js" }\nmodel A { id Int }\n',
    });
    expectOneCmd(dir, "schema.prisma");
  });
});

describe("prismaGenerateCmds: unsafe providers are skipped with a reason", () => {
  it("an extra prisma-dbml-generator gives no commands and a skip reason", () => {
    const dir = mkPrismaRepo({
      "package.json": prismaPkg(),
      "prisma/schema.prisma": 'generator client { provider = "prisma-client-js" }\ngenerator dbml { provider = "prisma-dbml-generator" }\nmodel A { id Int }\n',
    });
    const { cmds, skipped } = prismaGenerateCmds(dir);
    expect(cmds).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain("prisma-dbml-generator");
  });

  it('a node generator (provider = "node ./gen.js") is skipped', () => {
    const dir = mkPrismaRepo({
      "package.json": prismaPkg(),
      "prisma/schema.prisma": 'generator client { provider = "node ./gen.js" }\nmodel A { id Int }\n',
    });
    const { cmds, skipped } = prismaGenerateCmds(dir);
    expect(cmds).toEqual([]);
    expect(skipped[0]).toContain("node ./gen.js");
  });

  it("a prisma.config.ts in the package dir is skipped (it loads as code)", () => {
    const dir = mkPrismaRepo({
      "package.json": prismaPkg(),
      "prisma/schema.prisma": 'generator client { provider = "prisma-client-js" }\nmodel A { id Int }\n',
      "prisma.config.ts": "export default {};\n",
    });
    const { cmds, skipped } = prismaGenerateCmds(dir);
    expect(cmds).toEqual([]);
    expect(skipped[0]).toContain("prisma.config");
  });
});

describe("prismaGenerateCmds: schema locations", () => {
  it("honors the custom prisma.schema path from package.json", () => {
    const dir = mkPrismaRepo({
      "package.json": prismaPkg({ prisma: { schema: "./db/schema.prisma" } }),
      "db/schema.prisma": 'generator client { provider = "prisma-client-js" }\nmodel A { id Int }\n',
    });
    expectOneCmd(dir, path.join("db", "schema.prisma"));
  });

  it("passes a multi-file prisma/schema/ folder to generate", () => {
    const dir = mkPrismaRepo({
      "package.json": prismaPkg(),
      "prisma/schema/models.prisma": 'model A { id Int }\n',
      "prisma/schema/client.prisma": 'generator client { provider = "prisma-client-js" }\n',
    });
    const { cmds, skipped } = prismaGenerateCmds(dir);
    expect(skipped).toEqual([]);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]!.args).toEqual(["--no-install", "prisma", "generate", "--schema", path.join(dir, "prisma", "schema")]);
    expect(cmds[0]!.cwd).toBe(dir);
  });
});

describe("prismaGenerateCmds: monorepos", () => {
  it("a repo with two prisma packages gives two commands with the right cwd", () => {
    const dir = mkPrismaRepo({
      "package.json": JSON.stringify({ name: "root", private: true }),
      "packages/a/package.json": JSON.stringify({ name: "a", private: true, dependencies: { "@prisma/client": "^5.0.0" } }),
      "packages/a/prisma/schema.prisma": 'generator client { provider = "prisma-client-js" }\nmodel A { id Int }\n',
      "packages/b/package.json": JSON.stringify({ name: "b", private: true, dependencies: { "@prisma/client": "^5.0.0" } }),
      "packages/b/schema.prisma": 'generator client { provider = "prisma-client" }\nmodel B { id Int }\n',
    });
    const { cmds, skipped } = prismaGenerateCmds(dir);
    expect(skipped).toEqual([]);
    expect(cmds).toHaveLength(2);
    // Match by absolute cwd (Windows path.relative would use backslashes).
    const a = cmds.find((c) => c.cwd === path.join(dir, "packages", "a"))!;
    const b = cmds.find((c) => c.cwd === path.join(dir, "packages", "b"))!;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a.args[a.args.length - 1]).toBe(path.join(dir, "packages", "a", "prisma", "schema.prisma"));
    expect(b.args[b.args.length - 1]).toBe(path.join(dir, "packages", "b", "schema.prisma"));
  });
});

describe("prismaGenerateCmds: no prisma dependency", () => {
  it("gives no commands and no skip reasons", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-prisma-none-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", private: true, dependencies: { ai: "^5.0.0" } }));
    expect(prismaGenerateCmds(dir)).toEqual({ cmds: [], skipped: [] });
  });

  it("returns undefined from runPrismaGenerate so no gate key is stored", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-prisma-none-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", private: true }));
    expect(runPrismaGenerate(dir, () => { throw new Error("must not run"); })).toBeUndefined();
  });
});

describe("runGates runs prisma generate after install and before build", () => {
  it("runs generate (via the injected runner) after install and before build; a failed generate does not fail install", () => {
    const dir = mkPrismaRepo({
      "package.json": prismaPkg({ scripts: { build: "node -e 0" } }),
      "prisma/schema.prisma": 'generator client { provider = "prisma-client-js" }\nmodel A { id Int }\n',
    });
    const calls: string[] = [];
    const res = runGates(dir, "npm", false, [dir], {
      install: false,
      // The fake runner proves generate is invoked at all and with which command.
      prismaRunner: (c) => {
        calls.push(c.args.join(" "));
        return { ok: false, code: 1, output: "offline: engine download failed", ms: 0 };
      },
    });
    // The fake ran exactly the safe command, in the package dir.
    expect(calls).toEqual(["--no-install prisma generate --schema " + path.join(dir, "prisma", "schema.prisma")]);
    // install stayed ok even though generate failed (generate is not a gate).
    expect(res.install?.ok).toBe(true);
    expect(res[PRISMA_GENERATE_GATE]?.ok).toBe(false);
    expect(res[PRISMA_GENERATE_GATE]?.output).toContain("offline");
    // Order: install key first, generate second, build third (string keys keep insertion order).
    const keys = Object.keys(res);
    expect(keys.indexOf("install")).toBe(0);
    expect(keys.indexOf(PRISMA_GENERATE_GATE)).toBe(1);
    expect(keys.indexOf("build")).toBe(2);
    // prisma generate is never a regression.
    expect(regressions(res, { ...res, [PRISMA_GENERATE_GATE]: { ok: true, code: 0, output: "", ms: 0 } })).toEqual([]);
  });

  it("stores no key when the repo has no prisma package", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-prisma-gates-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", private: true }));
    const res = runGates(dir, "npm", false, [dir], { install: false, prismaRunner: () => { throw new Error("must not run"); } });
    expect(res[PRISMA_GENERATE_GATE]).toBeUndefined();
  });
});
