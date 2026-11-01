# Shim

Start with `docs/SPEC.md`: current status, architecture, and the work packages (WP0–WP12) with acceptance criteria.

Shim turns API breaking changes into tested PRs. First migration: AI SDK 6 -> 7.

## Commands
- `npm test` runs vitest. `npm run typecheck` runs tsc.
- `npx tsx src/cli.ts scan|fix|migrate <dir>`.
- `npx tsx src/cli.ts prepare <dir> --repo owner/name --out <d>` caches baseline, bump, codemod and deterministic fixes (no model calls). `finish <dir> --prep <d>/prepared.json --out <d> [--arch <id>] [--judge]` runs the fix stage.
- `npx tsx src/cli.ts pr open <draft-dir> --fork <forkOwner> [--allow-drift]` replays a draft on a fork branch and prints the compare URL. `pr record <owner/repo> <pr-url>` logs it. `pr status` refreshes `data/prs.csv`. `stats` regenerates `site/lib/stats.json`.
- `npx tsx src/evolve.ts --bench <dir> --repos a__b,c__d --out <dir> --set dev|holdout --hours N --concurrency 2 --budget-usd <n> [--only <archId>] [--mirror <dir>]` runs the architecture evolution loop.
- `scripts/` holds the batch scripts from the overnight run (`prep-one.sh`, `scale-one.sh`, `scale-all.sh`, `evolve.sh`, `collect.py`). They use `$SHIM_WORK`, default `~/shim-work`.

## Rules
- Fixes must preserve the target repo's current runtime behavior. Prefer a deterministic rewrite in `src/rules/` over the agent.
- Every new rule gets a fixture case in `test/fixtures/v6-app` and an assertion in `test/scan.test.ts`, including a case that must not be flagged.
- Never open a PR unless every gate that passed at baseline still passes (`src/gates.ts`). Otherwise open an issue.
- Installs of target repos always use `--ignore-scripts`.
- Keep replies and PR text short and specific; maintainers skim.
- Agents never open PRs, issues or comments on target repos. `shim pr open` pushes to Jayanth's fork, and Jayanth clicks Create. Never open a second PR on a repo already in `data/prs.csv`.
- Never use a Fable or Mythos model in the pipeline or the evolution. The allowlist is in `src/evolve-guard.ts`.
- This repo is public. Never commit secrets. `src/exec.ts` strips API keys from target-repo commands; keep it that way.

## Agent backend

Shim's agent runs (fixer, reviewer, judge, mutator) are configurable at runtime. No model id is hard-coded in the result.

### Environment variables

| Variable | Purpose | Fallback |
|---|---|---|
| `SHIM_AGENT_BACKEND` | `claude-cli` (default) or `dsh` | `claude-cli` |
| `SHIM_FIXER_MODEL` | Model id for the fixer agent | the seed in `arch.ts` |
| `SHIM_REVIEWER_MODEL` | Model id for the internal reviewer | the seed in `arch.ts` |
| `SHIM_JUDGE_MODEL` | Model id for the fixed judge (strict, never mutated) | the fallback in `agent.ts` |
| `SHIM_MUTATOR_MODEL` | Model id for the LLM mutator in the evolve loop | the fallback in `evolve.ts` |
| `SHIM_EXTRA_MODELS` | Comma-separated extra model ids to add to the allowlist | (none; built-in ids always present) |
| `SHIM_SECRET_PREFIXES` | Comma-separated extra env-var key prefixes to strip from target commands | (none; `ANTHROPIC_*`, `CLAUDE_*`, `AWS_*`, `GH_*`, `GITHUB_*`, `OPENAI_*` are always stripped) |
| `SHIM_SANDBOX` | Set to `1` to allow the `dsh` backend (throwaway container, no credentials) | unset (dsh refuses) |
| `ANTHROPIC_BASE_URL` | Route `claude-cli` through an Anthropic-compatible endpoint; cost becomes `null` (unpriced) | unset |

### Backends

- **`claude-cli`** (default): spawns the `claude` CLI. Works with any Anthropic-compatible endpoint via `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`. If the provider is only OpenAI-compatible, put a translating proxy in front (e.g. LiteLLM).
- **`dsh`**: runs `dsh --profile headless "<prompt>"` in the repo directory; stdout is the final text; exit 0/1 maps to ok/not-ok. Because `dsh` has no per-command allowlist or turn cap, it **refuses to start unless `SHIM_SANDBOX=1`** is set, meaning the run is inside a throwaway container or VM with no credentials in the environment. `SHIM_SANDBOX=1` is the **only** guard — set it only in a context with no credentials in the environment.

Both backends return the same `ExecResult` shape. `parseReview`'s last-line JSON contract is unchanged.

### Cost semantics

`--max-budget-usd` and the `cost` field in reports are meaningful only on the `claude-cli` backend with Anthropic's own pricing. When `ANTHROPIC_BASE_URL` is set or the backend is `dsh`, cost is recorded as `null` ("unpriced"); actual spend comes from the provider's dashboard.

### Model overrides

Set `<model id>` (e.g. the provider's model string) in the `SHIM_*_MODEL` variables. The built-in seed defaults in `arch.ts` are used only when the env var is unset. The Fable/Mythos ban is absolute: any model id containing `fable` or `mythos` (case-insensitive) is rejected by `sanitizeModels`, even when it appears in `SHIM_EXTRA_MODELS`.

---

# Handoff (written 2026-10-30)

## The task
Jayanth (founder) and cofounder Shekhar are applying to **YC W27, due 2026-11-02**. Shim is the product. The traction story is real upgrade PRs on open-source repos that use the Vercel AI SDK, moving them from v6 to v7, and the **merge rate** on those PRs. The work right now:
1. Get the open PRs merged. Answer maintainer feedback fast; quality matters more than count.
2. Open the remaining good drafts.
3. Have honest numbers for the application and the landing page: hit rate, green-but-wrong diffs caught by the judge, cost per PR, merge rate.
4. Finish the AlphaEvolve-style architecture evolution, ideally on an API key per `docs/evolve-runbook.md`, and adopt the winner as `DEFAULT_ARCH`.

Why Shim is more than the official codemod: AI SDK 7's breaking changes are **silent**. Tests and tsc still pass, but behavior changes.
- On multi-step calls (`stopWhen`/`maxSteps`, or an Agent), `usage`, `toolCalls`, `toolResults`, `content`, `text`, `warnings` and similar span **all** steps. `finalStep.*` keeps the v6 meaning.
- `response.messages` holds only the final step; use `responseMessages`.
- `role: 'system'` in `messages` is rejected. Shim sets `allowSystemInMessages: true` unless the messages are provably system-free.
- Tool `execute` options require `context`.
- `totalUsage` is deprecated.
- Node 22 is required, in `engines` and in CI.
- Default `stopWhen` is `isStepCount(1)`, so **single-step calls are unaffected**. Don't flag them.

The official `@ai-sdk/codemod@4.0.3` transform `v7/rename-google-generative-ai-to-google` renames the repo's own exports and breaks aliased imports (seen on cloudflare/ai). `src/codemod-guard.ts` catches it. A draft bug report for Vercel is in `data/overnight-2026-10-28/vercel-codemod-google-rename.md`; it hasn't been sent. Re-check it against the latest codemod first.

## State of the repo (main @ b6433c5, 2026-10-29)
- `main` contains everything below. The `evolve`, `evolve-guardrails`, `fix/target-env`, `fix/gitignored-scan`, `feat/pr-open`, `feat/pr-status` and `fix/windows-spawn` work is merged, as PRs #1–#7 or direct commits.
- **Not merged:** branch `claude/serene-babbage-yzfhbn`. It has `docs/evolve-runbook.md` (a prompt for running the evolution on an `ANTHROPIC_API_KEY` with a budget, an 8-repo dev set and a 5-repo holdout) and `drafts/` (every draft with `pr.md`, `changes.patch`, `judge.txt`, `status.txt`, plus `drafts/READY.md` and `SUMMARY.csv`). It branched from older code, so **cherry-pick `docs/` and `drafts/` only. Don't merge it**: it would revert newer src, site and test files.
- `site/` is the landing page (static Next.js on Vercel). `.github/workflows/refresh-site.yml` runs every 6 hours: `shim pr status` refreshes `data/prs.csv`, `shim stats` refreshes `site/lib/stats.json`, and the bot commits both.
- It now runs on Windows too (cross-spawn, LF-normalized patches, EBUSY retries). Jayanth runs Shim locally.

## Key files and architecture decisions
- **Pipeline** (`src/pipeline.ts`): `prepare` (baseline gates, bump, codemod, deterministic rewrites) is cached to `prepared.json`. `finish` (fix stage, gates, judge, report) consumes it. `migrate` = both. The split means every architecture is scored from an identical starting state, and the slow setup runs once per repo.
- **Scanner and rules** (`src/scan.ts`, `src/rules/ai-sdk-v7.ts`):
  - ts-morph follows result variables and end events.
  - `multiStep` can be `"maybe"` when options come from a variable or opaque spread; those go to the agent.
  - The typed rule catches values declared as `GenerateTextResult` and similar.
  - Rules cover system messages, CI Node version, and `totalUsage` only on SDK results.
  - It only scans files git would commit.
- **Fix stage = a genome** (`src/arch.ts`): candidates, attempts, models, fixer and reviewer rules text, audit, reviewer feedback rounds, `fixerChecks`, selection.
  - Seeds: `v1-single-retry`, `v2-parallel-review` (= `DEFAULT_ARCH`), `v3-review-feedback-audit`, `v4-fixer-runs-checks`.
  - `src/candidates.ts` runs parallel candidates on copies. `src/copy.ts` hard-links `node_modules`, and candidates reinstall only when a manifest changes.
  - Ranking: approved and green first, then by regressions, remaining findings and diff size.
- **Fixed judge** (`JUDGE_RULES`/`runJudge` in `src/agent.ts`, opus) is stricter than the internal reviewer and **never mutated**, so a variant can't raise its score by weakening its own reviewer. If the judge changes, start a fresh archive.
- **Score:** shipped = open-pr and judge approved. Also logged: gate pass, false pass (green but judge-rejected), cost, minutes.
- **Fixer guardrails** in the rules text and the judge:
  - no casts or suppressions that hide type errors
  - no public-type annotations
  - type-only test edits allowed
  - format and eslint-fix only files that were clean before Shim touched them
  - never change function signatures
- **Evolution** (`src/evolve.ts`, `src/evolve-guard.ts`):
  - It keeps an archive, and the LLM mutator (opus) reads past runs and proposes children.
  - Results are resumable and can be pushed durably via `--mirror`.
  - `--budget-usd` stops before an evaluation that would exceed the budget.
  - The genome is bounded (candidates 1–4, attempts 1–3, turns ≤60, review rounds ≤2) and the models are allowlisted (opus/sonnet/haiku).
- **Exec** (`src/exec.ts`):
  - `runClaude` waits out plan usage limits.
  - `SAFE_ENV` sets `CI=1` and `npm_config_verify_deps_before_run=false`. Without it, pnpm 11 silently runs `pnpm install` with lifecycle scripts before `pnpm run`.
  - Target commands never get API keys.
- **PR text** (`src/pr-body.ts`): it claims only what the patch did, puts open questions under "Needs your eyes", and adds a major changeset when `.changeset/config.json` exists.

## Results
- **PRs opened: 14, all open, 0 merged as of 2026-10-29** (`data/prs.csv`):
  - requesty #66, toolroute #30, xtruder #4, frayme #1, jodit #1, ChainFuse #1136, aws/bedrock-agentcore #308, zeabur #24, merge-api #7, apertis #8, VoxellInc #2, voight #1, aorizondo #2, HoudiniSwap #29.
  - Replies so far: ChainFuse (3 comments) and requesty (1). **Read and answer these first.**
- **Drafts not yet opened** (see `drafts/READY.md` on the serene-babbage branch):
  - Needs a human review first: yadimon/prio-llm-router, neurophic/neurophic-sdk-js, KrzysztofMarmol/mjml-agent-editor, upstash/context7.
    - neurophic and context7: the fixer added `Tool<...>` annotations to exports.
    - mjml: unexplained generic removals.
    - yadimon: multi-step reads on options built elsewhere.
  - Not ready: muxinc/ai (judge rejected; the old fork branch from 2026-10-27 is stale), dpuyosa/venice, echoVic/blade-agent-sdk, ashwinpaulallen/ottrix.
  - cloudflare/ai is held back because of the codemod export bug.
- **Overnight scale pass, 2026-10-28** (`data/overnight-2026-10-28/scale-results.csv`):
  - 45 targets: 23 attempted, 11 PR-ready (48%), **5 green-but-wrong diffs caught by the judge**, 7 issues, 18 skipped, 4 unfinished.
  - Of the skips, **12 of 45 had already self-migrated to v7**. This is a market signal: active maintainers move fast, so the wedge is the long tail plus the silent bugs in self-migrations.
- **Evolution** (`data/overnight-2026-10-28/LOG.md`, `archive.jsonl`):
  - `v1-single-retry`: 3/5 shipped on the old 5-repo dev set, $6.87, 35 min.
  - v2: incomplete. Its Cloudflare candidates regressed every test, which looks like an environment problem.
  - v3, v4 and the children were never run, because a container restart and the 2-hour background-job cap killed the runs.
  - The runbook defines a new 8-repo dev set plus a 5-repo holdout. Use that; don't reuse this archive.
- The overnight report doc is at https://claude.ai/artifact/PLuKMK4kuj2Fx4ZoXh8zj7. Its counts predate the 14 PRs.

## Gotchas
- Claude plan limits interrupt long runs. Mark limit-tainted runs invalid and rerun them. On an API key, verify with `claude -p "reply ok" --output-format json` that `total_cost_usd` is present.
- Cloud sessions cap background jobs at 2 hours and can restart the container. Run work in resumable chunks, or on a box that stays up (tmux).
- Kill explicit pids. `pkill -f` can match your own shell.
- Disk: monorepos are about 2 GB each. Delete clones after `finish` and keep `node_modules` hard-linked.
- Run evolution from a frozen checkout, so edits don't change a variant mid-run.
- Drafts drift: `pr open` refuses when upstream HEAD moved since the draft's `status.txt` unless `--allow-drift` is passed. Prefer re-running the draft.
- A cloud session can't attach an upstream repo when a fork with the same name exists, so Jayanth relays maintainer replies.

## Next steps (in order)
- [ ] **Answer maintainer replies** on ChainFuse/packages#1136 and requestyai/ai-sdk-requesty#66. Draft the replies for Jayanth to post; push fixes to the fork branch `shim/ai-sdk-7`. Run `npx tsx src/cli.ts pr status` to refresh counts.
- [ ] Cherry-pick `docs/evolve-runbook.md` and `drafts/` from `claude/serene-babbage-yzfhbn` onto main, without merging that branch.
- [ ] Review the 4 "needs review" drafts:
  - [ ] Fix them; for example, drop the exported `Tool<...>` annotations and explain the mjml edits in `pr.md`.
  - [ ] Re-run `finish --judge`.
  - [ ] Then `pr open <draft> --fork JayanthMalladi`, Jayanth clicks Create, and `pr record`.
- [ ] Rerun the 4 unfinished scale repos with `scripts/scale-one.sh <owner__repo>`: Ryrahul/Vendure-ai, agentmail-to/agentmail-toolkit, silverprotocol/typescript-sdk, vargHQ/sdk.
- [ ] Discover fresh ai@6 targets (`src/discover.ts`, `src/triage.ts`). Code-change PRs make the strongest demo.
- [ ] Run the evolution per `docs/evolve-runbook.md`:
  - [ ] Get Jayanth's budget first.
  - [ ] Prove the cost model on v1.
  - [ ] Evolve on the dev set, check the winner on the holdout, and open a PR setting `DEFAULT_ARCH`.
- [ ] Turn the 7 open-issue outcomes into short issue drafts that each name the silent v7 break. Jayanth posts them.
- [ ] Decide with Jayanth whether to send the Vercel codemod bug report. Shekhar could own the Vercel relationship.
- [ ] Product:
  - [ ] Support pnpm `catalog:`; it blocked 4 repos.
  - [ ] Add a "scan already-migrated repos for silent v7 bugs" mode. The 12 self-migrated repos are the first targets.
- [ ] YC application: lead with merged and open PR counts, the 5 green-but-wrong catches, cost per PR, and the self-migration signal. Keep `site/` numbers live, not hand-edited.
