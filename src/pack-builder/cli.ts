/**
 * S06: the standalone build-pack entry. `npx tsx src/pack-builder/cli.ts <package> --from <v> --to <v>
 * --out <dir> [--changelog <file>] [--no-judge] [--candidates <json>]`. It imports ONLY
 * pack-builder/* — never src/migrations.ts — so it runs in the blind benchmark copy (where the
 * target library's rule file is deleted) and in the real repo alike. The same command is also
 * wired into src/cli.ts (`build-pack`) for convenience; this is the decoupled, dependency-free path.
 *
 *   --no-judge      run the deterministic spine (evidence -> harness -> output), skip the model judge
 *   --candidates    load a hand-written candidate set (Candidate[]) and skip the model draft stage;
 *                   use it to re-score a planted rule without the unauthenticated CLI
 */
import fs from "node:fs";
import path from "node:path";
import { buildPack } from "./build.js";
import type { Candidate } from "./types.js";

const arg = (name: string, argv: string[]) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  const [cmd, pkg, ...rest] = process.argv.slice(2);
  if (cmd !== "build-pack" || !pkg) {
    console.error("usage: tsx src/pack-builder/cli.ts build-pack <package> --from <v> --to <v> --out <d> [--changelog <f>] [--no-judge] [--candidates <json>]");
    process.exit(1);
  }
  const from = arg("--from", rest), to = arg("--to", rest), out = arg("--out", rest);
  const changelog = arg("--changelog", rest);
  const candidatesJson = arg("--candidates", rest);
  if (!from || !to || !out) {
    console.error("build-pack requires --from, --to, --out");
    process.exit(1);
  }
  const candidates = candidatesJson ? JSON.parse(fs.readFileSync(path.resolve(candidatesJson), "utf8")) as Candidate[] : undefined;
  const report = await buildPack({
    package: pkg,
    from,
    to,
    outDir: path.resolve(out),
    changelog: changelog ? path.resolve(changelog) : undefined,
    noJudge: rest.includes("--no-judge"),
    candidates,
  });
  console.log(JSON.stringify({ package: report.package, shipped: report.shipped, admitted: report.admitted, cost: report.cost, draftModel: report.draftModel, judgeModel: report.judgeModel }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
