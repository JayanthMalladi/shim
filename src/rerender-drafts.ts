/**
 * Regenerate pr.md for every ready or needs-review draft from its saved report.json and changes.patch,
 * then refresh the "Needs your eyes" items in READY.md. No agent runs: it only re-renders saved data.
 *
 *   npx tsx src/rerender-drafts.ts [drafts-dir]
 */
import fs from "node:fs";
import path from "node:path";
import { prBody } from "./pr-body.js";

const dir = path.resolve(process.argv[2] ?? "drafts");
const eyes = new Map<string, string>();

for (const name of fs.readdirSync(dir)) {
  const d = path.join(dir, name);
  const read = (f: string) => (fs.existsSync(path.join(d, f)) ? fs.readFileSync(path.join(d, f), "utf8") : undefined);
  const status = read("status.txt")?.split("\n")[0]?.trim();
  if (status !== "ready" && status !== "needs-review") continue;
  const body = prBody(JSON.parse(read("report.json")!), read("changes.patch"));
  fs.writeFileSync(path.join(d, "pr.md"), body);
  const section = body.match(/### Needs your eyes\n[^\n]*\n([\s\S]*?)\n\n### /)?.[1];
  eyes.set(name, section ? section.split("\n").map((l) => l.replace(/^- /, "")).join("; ") : "none");
  console.log(`${name}: ${status}`);
}

const ready = path.join(dir, "READY.md");
if (fs.existsSync(ready)) {
  const lines = fs.readFileSync(ready, "utf8").split("\n").map((line) => {
    const m = line.match(/draft: `drafts\/([^/]+)\/`/);
    const items = m && eyes.get(m[1]!);
    return items ? line.replace(/ Needs your eyes: .*$/, ` Needs your eyes: ${items}`) : line;
  });
  fs.writeFileSync(ready, lines.join("\n"));
}
