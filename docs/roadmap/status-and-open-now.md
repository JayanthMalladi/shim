# Status and what to open now

As of 2026-10-28, evening. **Open 12 PRs now:** 10 as they are, and 2 with a one-line CI change added. All 12 drafts still match their upstream repo's HEAD, so every patch applies cleanly. The 4 needs-review and 5 not-ready repos wait for a rerun or a decision (below).

## Open now: 12 PRs

Open the code PRs first, since they show what Shim does, then the deps-only ones, which are the easiest merges. Space them out over Oct 29–30 rather than all at once.

| # | Repo | Kind | Checks kept green | PR CI on Node 22? | Needs your eyes |
| --- | --- | --- | --- | --- | --- |
| 1 | [nkwib/toolroute](https://github.com/nkwib/toolroute) | code | 4/4 | **No:** `ci.yml` and `sdk-compat.yml` use Node 20. Add the CI change (below). | Node 22 requirement |
| 2 | [xtruder/opencode-claude-max-plugin](https://github.com/xtruder/opencode-claude-max-plugin) | code | 3/3 | Yes (Node 26) | none |
| 3 | [frayme-ai/frayme-sdk](https://github.com/frayme-ai/frayme-sdk) | code | 7/7 | Yes (22) | Node 22 in `packages/api` and `packages/runtime` |
| 4 | [aorizondo/opencode-claude-code-acpbridge](https://github.com/aorizondo/opencode-claude-code-acpbridge) | code | 4/4 | No CI | Node 22 requirement |
| 5 | [jodit/jodit-ai-adapter](https://github.com/jodit/jodit-ai-adapter) | code | 3/3 | Yes (`.nvmrc` = 22) | Node 22 requirement |
| 6 | [ChainFuse/packages](https://github.com/ChainFuse/packages) | code | 3/3 | Yes (`lts/*`, `latest`) | none |
| 7 | [aws/bedrock-agentcore-sdk-typescript](https://github.com/aws/bedrock-agentcore-sdk-typescript) | deps-only | 4/4 | Yes (22.x; Node 20 only in the docs-publish job) | Node 22 requirement |
| 8 | [zeabur/ai-sdk](https://github.com/zeabur/ai-sdk) | deps-only | 3/3 | Yes (22) | none |
| 9 | [merge-api/merge-gateway-ai-sdk-provider](https://github.com/merge-api/merge-gateway-ai-sdk-provider) | deps-only | 4/4 | No CI | Node 22 requirement |
| 10 | [apertis-ai/apertis-sdk](https://github.com/apertis-ai/apertis-sdk) | deps-only | 4/4 | **No:** the `ci.yml` matrix is `[18, 20, 22]`. Add the CI change (below). | Node 22 requirement |
| 11 | [VoxellInc/forge-ai-provider](https://github.com/VoxellInc/forge-ai-provider) | deps-only | 4/4 | Yes (22) | none |
| 12 | [voightxyz/voight-vercel-ai](https://github.com/voightxyz/voight-vercel-ai) | deps-only | 4/4 | No CI | Node 22 requirement |

Each draft is in `drafts/<owner>__<repo>/` on branch `claude/serene-babbage-yzfhbn`:
- `pr.md` is the PR body. Paste it verbatim.
- `changes.patch` is the full diff, lockfile included.

### How to open one

In your fork's clone, on a fresh copy of the default branch:

```bash
git checkout -b shim/ai-sdk-7
```

```bash
git apply --3way /path/to/shim/drafts/<owner>__<repo>/changes.patch
```

```bash
git add -A && git commit -m "Upgrade to AI SDK 7"
```

```bash
git push -u origin shim/ai-sdk-7
```

Then open the PR against the upstream default branch, with `pr.md` as the body. Add a row to `data/prs.csv`: repo, PR URL, opened date, `open`.

### The CI change for toolroute and apertis

AI SDK 7 requires Node 22, so a PR whose CI still runs Node 18 or 20 will go red on day one. Put this in the same PR, as a second commit, and mention it in one line at the end of the PR body ("CI now runs on Node 22, which AI SDK 7 requires.").

- **toolroute:** in `.github/workflows/ci.yml` (two places) and `.github/workflows/sdk-compat.yml`, change `node-version: '20'` to `node-version: '22'`.
- **apertis:** in `.github/workflows/ci.yml`, change `node-version: [18, 20, 22]` to `node-version: [22]`. Leave `publish.yml` alone; it doesn't run on PRs.

## Hold: needs review (4)

Rerun these on current `main`, which has fix J (no public-type annotations, type-only test edits allowed) and the honest PR bodies. Don't open the old drafts.

| Repo | Why it's held | Upstream moved? | Next step |
| --- | --- | --- | --- |
| yadimon/prio-llm-router | Multi-step `usage`/`warnings` reads behind options built elsewhere weren't fixed | Yes (7d2ac17 → d6a204a) | Rerun; if the reads remain, a human decides |
| neurophic/neurophic-sdk-js | The fixer added a `Tool<…>` return type to an exported function, widening the public type | No | Rerun (fix J forbids it now) |
| upstash/context7 | The same public-type annotations | Yes (5c368c9 → a6774bc) | Rerun |
| KrzysztofMarmol/mjml-agent-editor | Unexplained edits: 10 tool generics removed, and a usage field remapped without optional chaining | No | Rerun; read the diff before opening |

## Not ready (5)

| Repo | Reason | What fixes it | Action |
| --- | --- | --- | --- |
| HoudiniSwap/houdiniswap-agent | Root `@ai-sdk/anthropic` was left on v3 | Fix I, already on `main` | Rerun (about $3) |
| ashwinpaulallen/ottrix | Needed a type-only test edit (`context`), which the fixer was forbidden to make | Fix J, already on `main` | Rerun (about $3) |
| dpuyosa/venice-ai-sdk-provider | Real break: the provider implements the v3 spec, and `@ai-sdk/openai-compatible@3` returns v4 models | The provider spec v4 rule (not built) | Open an **issue** with the exact error (TS2352 at `src/venice-provider.ts:113`), per `CLAUDE.md` |
| muxinc/ai | The official codemod rewrote the project's own `TokenUsage` type | Engine bug 2 (codemod guard) | Wait for the fix. No issue: the bug is ours, not theirs. |
| echoVic/blade-agent-sdk | The codemod renamed `fullStream` while mocks kept the old shape; `test .` was red at baseline | Engine bugs 2 and 3 | Wait for the fixes. No issue. |

## Branches

| Branch | State | Action |
| --- | --- | --- |
| `main` (363d9a1) | The product: fixes A to J, the landing page, 45 tests | Keep |
| `claude/serene-babbage-yzfhbn` | `drafts/` and the evolve runbook | Keep as the drafts store; consider moving `drafts/` to a private repo |
| `roadmap-docs` | These docs | Merge into `main` when you're happy with them |
| `evolve-guardrails` | Budget stop, allowlist, bounds, durable results | **Two bugs to fix first:** the budget double-counts reruns of an archived arch (blocks the holdout phase), and `--mirror` can push to `main` |
| `fix/gitignored-scan` | Scanner uses `git ls-files` | **One bug to fix first:** silently scans 0 files when the folder has no `.git` and sits inside an ignored dir of another repo. Also use `ls-files -z` for non-ASCII paths. |
| `evolve`, `fixer-v2` | Fully contained in `main` | Safe to delete |

## Remaining before Nov 2

**You:**
- [ ] Open the 10 clean PRs, and the 2 with the CI change, over Oct 29–30
- [ ] Log each one in `data/prs.csv`
- [ ] Answer maintainer comments within hours
- [ ] Open the venice issue
- [ ] Choose an npm scope, so the site and PR bodies stop saying `npx shim` (that name is an unrelated package)
- [ ] Fill `site/lib/site.ts` (waitlist, GitHub App link, price, founder name) and deploy `site/` to Vercel
- [ ] Record the 60-second demo
- [ ] Verify the API provider (token-count and caching probe) before any paid evolution run
- [ ] Write the application on Nov 1 from `data/prs.csv`

**Claude, when you say go:**
- [ ] Fix the bugs on `evolve-guardrails` and `fix/gitignored-scan` with tests, then merge (no agent spend)
- [ ] Rerun the 4 needs-review repos plus HoudiniSwap and ottrix on `main` (about $15–20)
- [ ] Build `shim pr open` and `shim pr status` (no agent spend)
- [ ] Prepare the CLI for publishing under your scope, and update the site command

## Budget

About $45 of the $91 is left. The plan is about $20 for the 6 reruns, leaving about $25 for maintainer follow-ups.
