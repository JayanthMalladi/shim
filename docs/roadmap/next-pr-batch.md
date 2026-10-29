# Roadmap: next PR batch and target expansion

Updated 2026-10-29. Owner: Shim. Supersedes the "open now" list in [status-and-open-now.md](status-and-open-now.md) for the repos covered below.

## Why this batch

As of the 2026-10-27 run data: 14 PRs opened, 0 merged, 0 closed-unmerged. YC-grade proof of the "merge rate" number needs **merges, not openings**. This batch has two jobs:

1. **Re-run and open the 17 held PRs** — the 2026-10-27 run produced `pr-ready` outcomes for 17 repos that never got opened (the 14 in `data/prs.csv` are the only ones opened so far). Same pipeline, same branch `shim/ai-sdk-7`.
2. **Expand the target pool** — the current target file covers ~1000 candidates but only ~20 repos actually produced a pr-ready outcome. We need to widen the net: more AI-SDK-6 repos via a fresh `discover` sweep, plus non-`ai`-first-party repos that import `ai` transitively.

The merge-rate denominator is **every opened PR that has been open ≥3 days** (matches `pr-status.ts` rate denominator). Track it here after each run.

## Held PR-ready repos (from scale-results-2026-10-27.csv)

| # | Repo | Kind | Cost | Notes |
|---|---|---|---|---|
| 1 | HoudiniSwap/houdiniswap-agent | code | $4.31 | 4 checks; agent-fixed; already in prs.csv |
| 2 | VoxellInc/forge-ai-provider | deps-only | $0.16 | |
| 3 | apertis-ai/apertis-sdk | deps-only | $0.19 | |
| 4 | aws/bedrock-agentcore-sdk-typescript | deps-only | $0.28 | AWS repo; high signal |
| 5 | merge-api/merge-gateway-ai-sdk-provider | deps-only | $0.06 | |
| 6 | neurophic/neurophic-sdk-js | code | $4.60 | |
| 7 | nkwib/toolroute | code | $0.18 | |

**Re-open candidates (already in prs.csv, re-check if still open):** HoudiniSwap #29, VoxellInc #2, apertis #8, aws #308, merge-gateway #7. The `pr status --write` command refreshes these; any that got merged or closed by maintainers drop out of the batch.

## Discovered but not yet run (triage rows in targets-2026-10-27.json with no scale-result row)

Pull these from `data/targets-2026-10-27.json` where `break + silent + deprecated > 0` and no matching row exists in `data/scale-results-*.csv`. As of 2026-10-29, roughly **30-40 repos** fall in this bucket. Priority:

- **break > 0** (runtime would fail on v7): probelabs/probe, cloudflare/ai, muxinc/ai, shogo-labs/shogo-ai, requestyai/ai-sdk-requesty, KrzysztofMarmol/mjml-agent-editor, Uluops/-uluops-core, lumea-labs/polpo, Wiseair-srl/orpc-agent
- **silent > 0** (silent behavior change; the wedge where Shim beats the codemod): upstash/context7, mcpc-tech/mcpc, comet-ml/opik
- **deprecated only**: sqlrooms/sqlrooms, cc01cc/cmtx-project, almero-digital-marketing/mikser-io-vector

Run these through `migrate --agent` with the V2 architecture (`candidates: 3, attempts: 2, review: true`).

## Fresh discovery sweep

The discover query set (`src/discover.ts` QUERIES) currently uses `keywords:ai-sdk` and related. Add:

- `keywords:vercel-ai-sdk`, `keywords:ai-sdk-provider`, `keywords:ai-sdk-tools` (already present — verify they all return results)
- `keywords:ai`, `keywords:llm`, `keywords:ai-agent` — broader net, expect more noise; filter by `aiRange` on `ai` specifically
- `dependencies:ai@^6` — direct dependency, not keyword (npm search doesn't support this natively; needs a registry walk)

**Output:** a new `data/targets-<date>.json` with the same schema. Target: 3× the current pool (~3000 candidates) to find 50 more repos with `break > 0` or `silent > 0`.

## Non-`ai`-first-party targets (transitive importers)

Roughly 30-40% of the current pool imports `ai` only via `@ai-sdk/*` providers or via `useChat` (React). These are still valid targets: a `useChat` app on v6 has the same silent `usage`/`messages` semantic change. Add a discover query for `keywords:useChat` and `keywords:ai-sdk/react`.

## What "better numbers" looks like

Target for the next `pr status` refresh (one week out):

| Metric | Current | Target |
|---|---|---|
| PRs opened | 14 | 40+ |
| PRs merged | 0 | 5+ (≥3 in the last 7 days) |
| PRs closed-unmerged | 0 | ≤ 2 |
| Merge rate (denom ≥3 days) | — | ≥ 25% |
| False-merge rate (merged with human edits) | — | ≤ 30% |

If after the batch the merge rate is <15%, the next iteration is to **narrow the target pool** (only repos with a maintainer who responds within 48h) rather than widen it.

## Merge-request workflow (for each held PR)

1. `shim pr open <draft-dir> --fork <owner>` — replays `changes.patch` onto a fresh `shim/ai-sdk-7` branch of the operator's fork, pushes, prints the compare URL.
2. A human opens the PR from the compare URL (or a GitHub App does, pending [docs/roadmap/yc-big-picture.md](yc-big-picture.md) distribution plan).
3. `shim pr record <owner/repo> <pr-url>` — appends to `data/prs.csv`.
4. `shim pr status --write` (daily) — refreshes `state`, `merged_at`, `comments` in the CSV and prints the running merge rate.
5. Weekly: re-run `pr status` on the whole CSV, close any PRs that went stale >14 days, log the merge in the `notes` column of `prs.csv`.

## Out of scope for this batch

- The `judge-rejected` and `open-issue` outcomes from the 2026-10-27 run: these are held by design. Re-running them requires either (a) the fixer rules in `arch.ts` to be loosened, or (b) a new architecture variant via `evolve`. Not the goal of this batch.
- The `pending` outcomes (FirstClassTree/shapelessai, Ryrahul/Vendure-ai, agentmail-to/agentmail-toolkit, silverprotocol/typescript-sdk): these stalled mid-run; re-run them as part of the held batch, don't count them separately.
- Any repo whose baseline install fails (`cc01cc/cmtx-project`, `almero-digital-marketing/mikser-io-vector`): the gates can't validate them; drop from the batch.

## File map

- New: `docs/roadmap/next-pr-batch.md` (this file)
- Update: `docs/roadmap/status-and-open-now.md` (link to this file, mark the held-PRs section as superseded)
- Data: `data/targets-<date>.json` (new, per sweep), `data/scale-results-<date>.csv` (new, per run)
- CSV: `data/prs.csv` (appended by `shim pr record`)

## Open questions (for the next YC-prep sync)

1. **Fork policy.** The current workflow pushes to `JayanthMalladi/<repo>` and a human opens the PR. Do we want a dedicated bot account (`shim-bot`) for the first 50 PRs so the "who's opening these" signal is cleaner? (GitHub's API rate limit for a single user is a concern at 40 PRs/week.)
2. **PR-merge SLA.** Is 14 days the right window before we close a stale PR and move on? Maintainer response times in the AI-SDK ecosystem look ~7 days median based on the `daysOpen` column of `prs.csv`.
3. **Judge rejection threshold.** 4 of ~30 runs in the 2026-10-27 batch were `judge-rejected`. Is that an acceptable false-negative rate for a "tested PR" product, or do we need to lower the judge bar (`JUDGE_RULES` in `agent.ts`)?
4. **Second rule set.** The platform story needs a second rule set in motion. Candidates: `zod v3 → v4` (has a silent `.safeParse` semantic change), `react 18 → 19` (useSyncExternalStore behavior), `prisma 5 → 6` (driver-adapter API). Which to build next?
