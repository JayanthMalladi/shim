/**
 * Find public packages still on ai@6 via the npm registry: search, then read each
 * package's latest manifest. Libraries with a GitHub repo and a recent release are
 * the best PR targets: active maintainers, and their users inherit the upgrade.
 */
const REGISTRY = "https://registry.npmjs.org";
const QUERIES = [
  "keywords:ai-sdk", "keywords:vercel-ai", "keywords:vercel-ai-sdk", "keywords:ai-sdk-provider",
  "keywords:ai-sdk-tools", "ai-sdk", "vercel ai sdk", "generateText", "streamText", "ai sdk agent",
  "ai sdk tools", "ai sdk provider", "ai sdk mcp", "useChat",
];

export interface Candidate {
  name: string;
  version: string;
  aiRange: string;
  repo: string;
  published: string;
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

const isV6 = (range: string) => /(^|[\^~>=\s|])6(\.|$|\s)/.test(range) && !/(^|[\^~>=\s|])7\./.test(range);

async function inspect(name: string, sinceMs: number): Promise<Candidate | undefined> {
  const doc = await getJson(`${REGISTRY}/${name.replace("/", "%2F")}`);
  const version = doc["dist-tags"]?.latest;
  const manifest = doc.versions?.[version];
  const published = doc.time?.[version];
  if (!manifest || !published || Date.parse(published) < sinceMs) return undefined;
  const aiRange = manifest.dependencies?.ai ?? manifest.peerDependencies?.ai ?? manifest.devDependencies?.ai;
  const repo = githubRepo(manifest);
  if (!aiRange || !isV6(aiRange) || !repo || repo.startsWith("vercel/")) return undefined;
  return { name, version, aiRange, repo, published };
}

export async function discover(days = 60, concurrency = 16): Promise<Candidate[]> {
  const names = new Set<string>();
  for (const q of QUERIES) for (const n of await searchNames(q)) names.add(n);
  console.error(`[discover] ${names.size} packages to inspect`);

  const sinceMs = Date.now() - days * 86_400_000;
  const queue = [...names];
  const found = new Map<string, Candidate>();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let n = queue.pop(); n; n = queue.pop()) {
      try {
        const c = await inspect(n, sinceMs);
        // One PR per repo: keep the most recently published package of a monorepo.
        if (c && (!found.has(c.repo) || found.get(c.repo)!.published < c.published)) found.set(c.repo, c);
      } catch {
        // Unpublished or unreadable packages are just skipped.
      }
    }
  }));
  return [...found.values()].sort((a, b) => b.published.localeCompare(a.published));
}
