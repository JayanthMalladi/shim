/**
 * Find public packages still on the old major via the npm registry: search, then read each
 * package's latest manifest. Libraries with a GitHub repo and a recent release are
 * the best PR targets: active maintainers, and their users inherit the upgrade.
 */
import { getMigration, type Migration } from "./migrations.js";

const REGISTRY = "https://registry.npmjs.org";
/** Search queries keyed by migration: the AI SDK path keeps its "ai" keyword queries;
 *  zod-v4 searches for packages that depend on zod. */
const QUERIES: Record<Migration["id"], string[]> = {
  "ai-sdk-v7": [
    "keywords:ai-sdk", "keywords:vercel-ai", "keywords:vercel-ai-sdk", "keywords:ai-sdk-provider",
    "keywords:ai-sdk-tools", "ai-sdk", "vercel ai sdk", "generateText", "streamText", "ai sdk agent",
    "ai sdk tools", "ai sdk provider", "ai sdk mcp", "useChat",
  ],
  "zod-v4": ["zod"],
};
/** The dependency each migration reads off a manifest: "ai" for AI SDK, "zod" for Zod. */
const DEP: Record<Migration["id"], string> = { "ai-sdk-v7": "ai", "zod-v4": "zod" };

export interface Candidate {
  name: string;
  version: string;
  aiRange: string;
  repo: string;
  published: string;
  /** Set only for zod-v4 candidates: the package ships a CLI (public types rarely expose schemas). */
  bin?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The search endpoint rate-limits hard; back off on 429 instead of failing the run. */
async function getJson(url: string, attempts = 6): Promise<any> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.ok) return res.json();
    if (res.status !== 429 || i >= attempts) throw new Error(`${res.status} ${url}`);
    await sleep(Number(res.headers.get("retry-after")) * 1000 || 2000 * 2 ** i);
  }
}

async function searchNames(query: string, max = 1000): Promise<string[]> {
  const names: string[] = [];
  for (let from = 0; from < max; from += 250) {
    const r = await getJson(`${REGISTRY}/-/v1/search?text=${encodeURIComponent(query)}&size=250&from=${from}`);
    names.push(...r.objects.map((o: any) => o.package.name));
    if (r.objects.length < 250) break;
  }
  return names;
}

function githubRepo(manifest: any): string | undefined {
  const url = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  const m = url?.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(\.git)?(#.*)?$/);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

const isV6 = (range: string) => /(^|[\^~>=\s|])6(\.|$|\s)/.test(range) && !/(^|[\^~>=\s|])7(\.|$|\s)/.test(range);

/** A real test script: present and not npm's "no test specified" stub (same check as gates.ts). */
const hasRealTest = (manifest: any) =>
  typeof manifest.scripts?.test === "string" && !manifest.scripts.test.includes("no test specified");

/** True when the package lists the dep as a peer: for zod, a library needing dual v3/v4 support. */
function peerSkip(manifest: any, dep: string): boolean {
  return (manifest.peerDependencies?.[dep] as string | undefined) !== undefined;
}

async function inspect(name: string, sinceMs: number, m: import("./migrations.js").Migration): Promise<Candidate | undefined> {
  const doc = await getJson(`${REGISTRY}/${name.replace("/", "%2F")}`);
  const version = doc["dist-tags"]?.latest;
  const manifest = doc.versions?.[version];
  const published = doc.time?.[version];
  if (!manifest || !published || Date.parse(published) < sinceMs) return undefined;
  const dep = DEP[m.id];
  const aiRange = manifest.dependencies?.[dep] ?? manifest.peerDependencies?.[dep] ?? manifest.devDependencies?.[dep];
  const repo = githubRepo(manifest);
  // The default (AI SDK) migration keeps the original isV6 filter so --migration ai-sdk-v7 behaves
  // exactly like today; a non-AI-SDK migration supplies its own old-major test.
  const isZod = m.id !== "ai-sdk-v7";
  const isOld = isZod ? m.isOldMajor : isV6;
  // Zod-specific: skip peer-dep (dual v3/v4 libraries), require a real test script.
  if (isZod && (peerSkip(manifest, dep) || !hasRealTest(manifest))) return undefined;
  if (!aiRange || !isOld(aiRange) || !repo || repo.startsWith("vercel/")) return undefined;
  const candidate: Candidate = { name, version, aiRange, repo, published };
  if (isZod) candidate.bin = Boolean(manifest.bin);
  return candidate;
}

export async function discover(days = 60, concurrency = 16, m?: import("./migrations.js").Migration): Promise<Candidate[]> {
  const mig = m ?? getMigration();
  const names = new Set<string>();
  for (const q of QUERIES[mig.id]) for (const n of await searchNames(q)) names.add(n);
  console.error(`[discover] ${names.size} packages to inspect`);

  const sinceMs = Date.now() - days * 86_400_000;
  const queue = [...names];
  const found = new Map<string, Candidate>();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let n = queue.pop(); n; n = queue.pop()) {
      try {
        const c = await inspect(n, sinceMs, mig);
        // One PR per repo: keep the most recently published package of a monorepo.
        if (c && (!found.has(c.repo) || found.get(c.repo)!.published < c.published)) found.set(c.repo, c);
      } catch {
        // Unpublished or unreadable packages are just skipped.
      }
    }
  }));
  // CLIs first (their public types rarely expose schemas), then most recently published.
  // bin is only set on non-AI-SDK candidates, so the AI SDK path sorts by recency as before.
  return [...found.values()].sort(
    (a, b) => Number(b.bin ?? false) - Number(a.bin ?? false) || b.published.localeCompare(a.published),
  );
}
