# Shim spec

Written 2026-10-31 for whoever works on Shim next, human or agent. Agents are expected to be DeepSeek models running in DeepSeek Harness (`dsh`). Read this file and `CLAUDE.md` before changing anything. Where they disagree, `CLAUDE.md` wins on rules and this file wins on the plan.

Contents:
1. What Shim is
2. Rules that never bend
3. Where things stand (2026-10-31)
4. Running work in DeepSeek Harness
5. Architecture
6. Data formats
7. Commands
8. Work packages (the backlog, with acceptance criteria)
9. How a PR gets opened
10. Gotchas

---

## 1. What Shim is

When an API you depend on changes, Shim opens a tested pull request that updates your code before it breaks.

The first migration is the **Vercel AI SDK 6 → 7**. Vercel ships an official codemod (`npx @ai-sdk/codemod v7`), so renames are a solved problem. Shim's value is the changes the codemod and `tsc` miss. Most of them are **silent**: the code still compiles and the tests still pass, but it reads different data at runtime.

The silent and runtime breaks Shim handles:

| Change in v7 | What breaks | Shim's fix |
|---|---|---|
| On multi-step calls (`stopWhen`, `maxSteps`, `Agent`), `usage`, `toolCalls`, `toolResults`, `content`, `text`, `warnings` etc. span **all** steps | Billing, logging and UI read totals instead of the last step | Read `result.finalStep.*`, which keeps the v6 meaning |
| `response.messages` holds only the final step | Chat history loses earlier steps | Use `responseMessages` |
| `role: 'system'` inside `messages`/`prompt` is rejected at runtime | Throws on the first call | `allowSystemInMessages: true`, unless the messages are provably system-free |
| Tool `execute` options require `context` | Type error or runtime undefined | Pass `context` |
| `totalUsage` deprecated | Removed in the next major | Report it |
| Node 22 required | CI on Node 18/20 goes red | Flag `engines` and CI versions |
| Telemetry moved to `@ai-sdk/otel` | Spans disappear | Flag |
| ESM-only | `require('ai')` fails | Flag |

The default `stopWhen` is `isStepCount(1)`. **Single-step calls are unaffected; never flag them.**

Why not just a coding agent? An agent waits to be asked, and it has no list of what changed, no map of the affected call sites, and no proof that it kept behavior. Shim brings all three: deterministic rules, gates measured against the repo's own baseline, and an independent judge that rejects diffs that pass the checks but are wrong. The overnight run caught 5 of those.

Business model (later): free on public repos to build the merge-rate number, then paid per org. Phase 2: API providers pay to push their migrations into their customers' code.

## 2. Rules that never bend

These are copied from `CLAUDE.md`. An agent that breaks one has failed its task, whatever else it did.

1. **Agents never open PRs, issues or comments on target repos.** `shim pr open` pushes to Jayanth's fork and prints a compare URL. Jayanth reads the diff and clicks Create. Never open a second PR on a repo that is already in `data/prs.csv`.
2. **Never open a PR unless every gate that passed at baseline still passes** (`src/gates.ts`). Otherwise the outcome is an issue draft.
3. **Installs of target repos always use `--ignore-scripts`.** Target repos are untrusted code.
4. **Target commands never get credentials.** `src/exec.ts` strips `ANTHROPIC_*`, `CLAUDE_*`, `AWS_*`, `GH_*` and `GITHUB_*` from target-repo commands. Keep it that way, and add `DEEPSEEK_*` when you touch it (see WP1).
5. **Fixes must preserve the target repo's current runtime behavior.** Prefer a deterministic rewrite in `src/rules/` over the agent.
6. **Every new rule gets a fixture case** in `test/fixtures/v6-app` and an assertion in `test/scan.test.ts`, including a case that must **not** be flagged.
7. The fixer must never: add casts or suppressions that hide type errors, add public-type annotations, change function signatures, or reformat files Shim didn't otherwise touch. Type-only edits in test files are allowed.
8. The fixed judge (`JUDGE_RULES` in `src/agent.ts`) is never edited to make a variant score better. If the judge changes, its scores start a fresh archive.
9. This repo is public. Never commit secrets, tokens or `.env` files.
10. Never use a Fable or Mythos model anywhere in the pipeline or the evolution (`src/evolve-guard.ts`).
11. Keep PR text and replies short and specific. Maintainers skim.

## 3. Where things stand (2026-10-31)

### PRs
14 opened on 2026-10-27..29, all open, **0 merged, 0 closed, 0 human replies**. The comments on ChainFuse#1136 and requesty#66 are all bots: changeset-bot and socket-security. On both, CI workflows are waiting for maintainer approval because Jayanth is a first-time contributor, and requesty needs a code-owner review.

| Kind | Repos |
|---|---|
| Code change (8) | requestyai/ai-sdk-requesty#66, nkwib/toolroute#30, xtruder/opencode-claude-max-plugin#4, frayme-ai/frayme-sdk#1, jodit/jodit-ai-adapter#1, ChainFuse/packages#1136, aorizondo/opencode-claude-code-acpbridge#2, HoudiniSwap/houdiniswap-agent#29 |
| Deps only (6) | aws/bedrock-agentcore-sdk-typescript#308, zeabur/ai-sdk#24, merge-api/merge-gateway-ai-sdk-provider#7, apertis-ai/apertis-sdk#8, VoxellInc/forge-ai-provider#2, voightxyz/voight-vercel-ai#1 |

### Pipeline results (overnight 2026-10-28, `data/overnight-2026-10-28/`)
- 45 targets, 23 attempted, **11 PR-ready (48%)**, **5 wrong diffs caught by the judge even though every gate passed**, 7 issue outcomes, 18 skipped, 4 unfinished.
- **12 of 45 had already migrated to v7 themselves.** Active maintainers move fast. The opportunity is the long tail, plus silent bugs in those self-migrations.
- Agent cost per repo: $0.06–$5.63 on Claude.

### Drafts not yet opened (`drafts/`, see `drafts/READY.md`)
- Needs review: yadimon/prio-llm-router, neurophic/neurophic-sdk-js, KrzysztofMarmol/mjml-agent-editor, upstash/context7. See WP3.
- Not ready: muxinc/ai (judge rejected, stale fork branch), dpuyosa/venice-ai-sdk-provider, echoVic/blade-agent-sdk, ashwinpaulallen/ottrix.
- Held: cloudflare/ai. The official codemod renames that repo's own exports (`src/codemod-guard.ts` catches it). A bug report draft is in `data/overnight-2026-10-28/vercel-codemod-google-rename.md`; it hasn't been sent.

### Code health
- `npm run typecheck` is clean. `npm test`: 103/108 pass. The 5 failures (`syncMirror`, `formatChanged`, gitignored scan) happen only in Claude's cloud container. Check them on your machine (WP11).
- Open Shim PR #8 fixes `pr status` counting bot comments as maintainer replies. Merge it before trusting the reply count.

### Strategy decisions already made
- The YC application is deferred. Spend the time getting **merges**, not raw PR count.
- Expand to more repos, but choose targets for how likely they are to merge (WP6). Prefer code changes that fix a silent break over pure version bumps, which Renovate already does.
- For libraries, prefer widening to `^6 || ^7` over forcing a major bump (WP4).
- Use DeepSeek Harness for interactive work on this repo. Inside the pipeline (fixer, reviewer, judge in untrusted repos), keep the Claude Code CLI as the harness and point it at DeepSeek's endpoint (WP1, WP2). Section 4 explains why.

## 4. Running work in DeepSeek Harness

### Setup (once)
```sh
# Node 22+
npx @deepseek-ai/dsh web            # Web UI on http://127.0.0.1:3080
# or one-shot:
npx @deepseek-ai/dsh --profile headless "<task text>"
```
Start `dsh` from the Shim checkout. It uses the invoking directory as the workspace and loads `CLAUDE.md` automatically.

Settings to change before the first run:
- **Turn off session-log upload**: Web UI → Settings → General → "Upload Session Log when using the official model API" off, or set the `session-log-deepseek` plugin's `enabled: false`. Otherwise full session logs go to DeepSeek with later requests.
- `export DSH_TELEMETRY_MODE=DISABLED`.
- Don't keep `GITHUB_TOKEN`, `GH_TOKEN` or cloud credentials in the shell `dsh` starts from. The agent's bash sees that environment, and reads and network access are not sandboxed. `pr status` only needs `GITHUB_TOKEN` when you run it yourself.
- `dsh` is a developer preview. Its own SAFETY.md says not to rely on it as the only safety control. Run it in a VM or container when it will touch cloned target repos.

### What dsh should and shouldn't do
| Use dsh for | Don't use dsh for |
|---|---|
| Writing and testing Shim code (WP1, WP4, WP5, WP7, WP11) | Being the fixer or judge inside target repos. Its default `workspace-write` preset allows any bash command, and it has no per-command allowlist and no turn or budget cap. The pipeline's fixer may only run `tsc` and `git diff`. |
| Hand-fixing drafts (WP3), writing issue drafts (WP8), drafting replies | Opening PRs, issues or comments on any target repo |
| Running `shim discover`, `triage`, `prepare`, `stats` | Pushing to `main` without Jayanth |

### Prompt template for a dsh task
```
Read docs/SPEC.md and CLAUDE.md. Do work package WP<n> exactly as specified.
Stay inside its listed files unless a test forces otherwise. Run `npm run typecheck` and `npm test` before you finish.
Commit on a new branch named wp<n>-<short-name> with a message that says what changed and why. Do not push to main.
Report: what you changed, test results (paste the summary lines), and anything you were unsure about.
```

## 5. Architecture

### Pipeline
```
discover ─► triage ─► prepare ─────────────────────────► finish ───────────────────────► draft ─► pr open (human clicks Create) ─► pr record ─► pr status / stats
 (npm)     (clone,    baseline gates → bump → codemod →   fixer candidates → gates →
            scan)     deterministic rewrites → gates      reviewer → rank → judge → report
            no model  no model                            MODEL                            no model
```

`prepare` writes `prepared.json`, and `finish` consumes it, so every architecture is scored from an identical starting state and the slow setup runs once per repo. `migrate` runs both.

### Module map (`src/`)
| File | Role | Model? |
|---|---|---|
| `cli.ts` | Entry point: `scan`, `fix`, `migrate`, `prepare`, `finish`, `triage`, `discover`, `pr open/record/status`, `stats` | – |
| `discover.ts` | npm registry search for recently published packages still on `ai@6` | no |
| `triage.ts` | Read-only clone + scan of candidates, giving `data/targets-<date>.json` | no |
| `scan.ts` | ts-morph project load, the git-tracked file list, findings; Node 22 / CI checks | no |
| `rules/ai-sdk-v7.ts` | The v7 rules (ids below). Follows result variables and end events; `multiStep` can be `"maybe"` when options come from a variable or opaque spread, and those go to the agent | no |
| `codemod-guard.ts` | Flags exports the official codemod renamed (`codemod-renamed-export`) | no |
| `bump.ts` | Bumps `ai` to `^7.0.0` and `@ai-sdk/*` to their latest major, editing package.json text in place. Skips `workspace:`/`catalog:`/`npm:` and ranges that already allow the major | no |
| `gates.ts` | Detects the package manager; install (`--ignore-scripts`), build, per-package typecheck and test; per-test results for vitest/jest; `regressions(baseline, after)` | no |
| `pipeline.ts` | `prepare`, `finish`, `migrate`; verdict logic; formatter/eslint on touched-and-previously-clean files; changeset | – |
| `arch.ts` | The fix-stage "genome" (`Architecture`): candidates, attempts, models, rules text, audit, review rounds, `fixerChecks`, selection. Seeds `v1`..`v4`; `DEFAULT_ARCH` = `v2-parallel-review` | – |
| `candidates.ts` | Runs N fixer candidates in parallel on copies, ranks them (approved and green first, then regressions, remaining findings, diff size), adopts the winner | yes (via agent.ts) |
| `copy.ts` | Copies a repo per candidate, hard-linking `node_modules` | no |
| `agent.ts` | `runFixer`, `runReviewer`, `runJudge` (opus, fixed rules), `parseReview` (last-line JSON) | **yes** |
| `exec.ts` | `run`/`runAsync`; `targetEnv()` (no secrets, `CI=1`, `npm_config_verify_deps_before_run=false`) vs `agentEnv()`; `runClaude` (spawns `claude`, waits out plan limits) | – |
| `pr-body.ts` | Renders the PR text: versions, what changed, "Needs your eyes", gates table, rollback. Claims only what the patch did | no |
| `pr.ts` | `prOpen` (replay `changes.patch` on a fork branch `shim/ai-sdk-7`, refuse on upstream drift), `prRecord` (append to `data/prs.csv`, refuse duplicates) | no |
| `pr-status.ts` | Refreshes PR state, human comments and reviews from the GitHub API; merge rate over PRs open 3+ days | no |
| `stats.ts` | Writes `site/lib/stats.json` from `data/prs.csv` plus fixed proof facts | no |
| `evolve.ts`, `evolve-guard.ts` | AlphaEvolve-style loop over `Architecture`: archive, LLM mutator, budget stop, model allowlist, bounded genome | **yes** |
| `rerender-drafts.ts` | Re-renders `pr.md` and `READY.md` from saved reports | no |

### Rule ids
`multi-step-result`, `maybe-multi-step-result`, `typed-multi-step-result`, `multi-step-end-event`, `response-messages`, `system-in-messages`, `maybe-system-in-messages`, `tool-execution-context`, `total-usage`, `telemetry-needs-otel`, `esm-only`, `node-22`, `ci-node-version`, `codemod-renamed-export`.

Each finding has `severity` ∈ `break | silent | deprecated` and `fix` ∈ `auto | agent | manual` (`src/types.ts`).

### Verdicts (`finish`)
In order, the first match wins:
1. Any gate that passed at baseline fails now → `open-issue` ("gates regressed").
2. Unresolved non-deprecated findings → `open-issue`.
3. Baseline had no green typecheck or tests → `open-issue` ("no green typecheck or tests").
4. The internal reviewer rejected the diff → `open-issue`.
5. Otherwise → `open-pr`. With `--judge`, the fixed judge must also approve for it to count as **shipped**.

### Where models are called
All three go through `runClaude` → the `claude` CLI, with the full environment (`agentEnv()`):
- `agent.ts runFixer`: `--model arch.fixerModel`, tools limited to Read/Edit/Write/Glob/Grep, `npx --no-install tsc`, `git diff` (plus the repo's run scripts if `fixerChecks`), `--max-turns`, `--max-budget-usd 3`, `--output-format json`.
- `agent.ts runReviewer`/`runJudge`: read-only tools, last line must be `{"approve": bool, "issues": [...]}`.
- `evolve.ts:240`: the mutator, read-only tools.

`claude-opus-5-5` is hard-coded in `arch.ts` (seed defaults), `agent.ts:131` (judge) and `evolve.ts:240`, and listed in `ALLOWED_MODELS` in `evolve-guard.ts`. WP1 makes this configurable.

## 6. Data formats

### `data/prs.csv`: the PR ledger
`repo,stars,last_commit,pr_url,opened_at,state,merged_at,comments,notes`
- `pr status --write` rewrites only `state`, `merged_at` and `comments`. After PR #8, `comments` = issue comments from humans who aren't the PR author.
- One row per repo, ever. `pr record` refuses duplicates.
- The `refresh-site.yml` workflow runs every 6 hours: `pr status --write`, then `stats`, then commits.

### `drafts/<owner>__<repo>/`
| File | Content |
|---|---|
| `pr.md` | Title + body to paste |
| `changes.patch` | Full diff including lockfile; `git apply` on a fresh clone of the default branch |
| `report.json` | The `MigrationReport` from `finish` |
| `judge.txt` | The judge's verdict and issues |
| `status.txt` | Human notes; last line `HEAD: <sha>` = the upstream commit the draft was cut against |
| `body.md` | (some) earlier body versions |

`drafts/READY.md` is the checklist; `drafts/SUMMARY.csv` has one row per draft.

### `prepared.json` / `report.json`
See the `Prepared` and `MigrationReport` types in `src/pipeline.ts`. Key `report.json` fields: `repo, verdict, reason, versionChanges, library, codemod, autoFixed, before, remaining, baseline, after, regressions, diffStat, changedFiles, repairedChecks, agentRuns, candidates, review, failures, arch, cost, fixMs`. `finish --judge` also writes `result.json` with `judge`.

### `data/targets-<date>.json`
Triage rows: repo, package, `ai` range, and finding counts by severity. Used to pick what to run.

## 7. Commands

```sh
npm ci --ignore-scripts
npm run typecheck && npm test

npx tsx src/cli.ts scan <dir>                      # findings only
npx tsx src/cli.ts fix <dir>                       # deterministic fixes only
npx tsx src/cli.ts prepare <dir> --repo o/r --out <d>
npx tsx src/cli.ts finish <dir> --prep <d>/prepared.json --out <d> [--arch arch.json] [--judge]
npx tsx src/cli.ts migrate <dir> --repo o/r [--agent] [--out <d>]
npx tsx src/cli.ts discover [days=60] > candidates.json   # npm search; JSON on stdout
npx tsx src/cli.ts triage candidates.json [--work <dir>]  # clone + scan; JSON rows on stdout
npx tsx src/cli.ts pr open drafts/<o>__<r> --fork JayanthMalladi [--allow-drift]
npx tsx src/cli.ts pr record <o/r> <pr-url>
GITHUB_TOKEN=... npx tsx src/cli.ts pr status [--write]
npx tsx src/cli.ts stats

scripts/scale-one.sh <owner__repo>   # prepare + finish --judge into $SHIM_WORK/scale/<r>; deletes the clone after
scripts/scale-all.sh                  # every repo in data/overnight-2026-10-28/scale-repos.txt
```
`SHIM_WORK` defaults to `~/shim-work`. Monorepos take about 2 GB each during a run.

## 8. Work packages

Each one lists **who** can do it:
- **any**: no model needed; a human or any agent can run it.
- **dsh**: a DeepSeek agent in DeepSeek Harness, editing Shim code.
- **pipeline**: the fixer and judge run on a model; quality must be calibrated first (WP2).
- **Jayanth**: needs his GitHub account or judgment.

Priority order: WP0 → WP1 → WP2 → WP3 → WP4 → WP6 → the rest.

### WP0. Merge pending work (Jayanth, 5 min)
- Merge Shim PR #8 (`claude/project-thread-kp136j`). It contains the `pr status` bot fix, this spec, the handoff `CLAUDE.md`, the overnight data and scripts, `drafts/`, and `docs/evolve-runbook.md`.
- The `roadmap-docs` branch has older planning docs (`docs/roadmap/*`). They're superseded by this spec, so leave that branch unmerged.
- **Done when** `main` has `docs/SPEC.md` and the next `refresh-site` run shows "replied 0".

### WP1. Make the pipeline's model configurable (dsh, ~1 hour)
Goal: run the fixer, reviewer, judge and mutator on DeepSeek through the Claude Code CLI without editing code each time.
- In `src/arch.ts`, read `process.env.SHIM_FIXER_MODEL` and `SHIM_REVIEWER_MODEL` as the defaults for `fixerModel` and `reviewerModel` when set. Otherwise keep `claude-opus-5-5`.
- In `src/agent.ts`, the judge model = `process.env.SHIM_JUDGE_MODEL ?? "claude-opus-5-5"`.
- In `src/evolve.ts:240`, mutator model = `process.env.SHIM_MUTATOR_MODEL ?? "claude-opus-5-5"`.
- In `src/evolve-guard.ts`, extend `ALLOWED_MODELS` with entries from `SHIM_EXTRA_MODELS` (comma-separated). Still reject any id containing `fable` or `mythos`, case-insensitive. Add a test for that rejection.
- In `src/exec.ts`, add `DEEPSEEK_` to `SECRET_PREFIXES`, and test that `targetEnv()` drops `DEEPSEEK_API_KEY`.
- Document in `CLAUDE.md` how to run against DeepSeek:
  ```sh
  export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic   # check DeepSeek's docs for the current URL
  export ANTHROPIC_AUTH_TOKEN=$DEEPSEEK_API_KEY
  export SHIM_FIXER_MODEL=<deepseek model id> SHIM_REVIEWER_MODEL=<id> SHIM_JUDGE_MODEL=<id>
  export SHIM_EXTRA_MODELS=<ids>
  ```
- `--max-budget-usd` and `cost` assume Claude pricing. When `ANTHROPIC_BASE_URL` is set, label the cost "unpriced" in reports and logs instead of trusting it.
- **Done when** typecheck and tests pass, there are new tests for the env overrides and the Fable/Mythos rejection, and `claude -p "reply ok" --model <deepseek id> --output-format json` works with the env above (Jayanth runs this check).

### WP2. Calibrate DeepSeek against the Claude results (pipeline, Jayanth runs; ~half a day)
Goal: know whether DeepSeek-backed runs can open PRs.
- Set: the 11 repos that were PR-ready on 2026-10-28 (`data/overnight-2026-10-28/scale-results.csv`, `outcome=pr-ready`) plus the 5 judge-rejected ones.
- Run `scripts/scale-one.sh` for each with WP1's env set to DeepSeek. Write to a new `SHIM_WORK` so nothing gets overwritten.
- Compare per repo: verdict, judge verdict, diff size, and whether the diff matches the Claude draft's intent. Write the results to `data/calibration-deepseek-<date>.csv` and a 10-line summary to `data/calibration-deepseek-<date>.md`.
- Thresholds, decided before running:
  - DeepSeek can open **deps-only** PRs if it reproduces the Claude outcome on all deps-only repos.
  - It can open **code** PRs without extra review only if its judge rejects at least 4 of the 5 known-bad diffs, and it ships at least 70% of what Claude shipped.
  - Otherwise every code PR gets Jayanth's line-by-line review.
- **Done when** the CSV and summary are committed and the thresholds above are applied.

### WP3. Finish the four needs-review drafts (dsh, then Jayanth reviews)
For each one: clone upstream at the `HEAD:` in `status.txt` (or the latest commit), `git apply changes.patch`, make the edit below, run the repo's gates by hand (`--ignore-scripts` installs), regenerate `changes.patch` with `git add -A && git diff --cached --binary`, and update `pr.md` and `status.txt`.
- **neurophic/neurophic-sdk-js**: remove the hand-written `Tool<...>` return annotation and the new `RetrieveResponse` import on exported `createTools` in `packages/ai-sdk/src/tools.ts`. If typecheck then fails, find the minimal fix that doesn't widen the public type, or move the draft to "not ready".
- **upstash/context7**: remove the `Tool<...>` annotations on exported `queryDocs` and `resolveLibraryId`, with the same fallback. Keep the `finalStep.*` test-read changes and mention them in `pr.md`.
- **KrzysztofMarmol/mjml-agent-editor**: revert the generic removals on the 10 `tool<...>()` calls in `agent-node/src/tools.ts` unless typecheck needs them. If it does, say so in `pr.md`. Use optional chaining on `inputTokenDetails?.cacheReadTokens`, and explain the `sumUsage` change in `pr.md`.
- **yadimon/prio-llm-router**: leave the code alone. Make sure `pr.md` lists the multi-step reads on options built elsewhere (`provider-factory.ts:72,77,105,108`) under "Needs your eyes" with a one-line question for the maintainer.
- **Done when** each draft's `status.txt` says "ready" with the gates table, and Jayanth has read the diff. Then follow section 9.

### WP4. Widen instead of bump for libraries (dsh, ~2–3 hours)
Goal: make library PRs easier to merge. Maintainers resist "drop v6, needs a major release".
- In `src/bump.ts`, add an option `{ widenPeers: boolean }`. When it's true and the field is `peerDependencies`, rewrite `^6.x` to `^6.x || ^7.0.0` instead of replacing it. Keep `devDependencies` bumped to v7 so the repo's tests run against v7.
- Only safe when the library's own code compiles against both, so the pipeline's gates must pass on v7 and the code must use no v7-only API. In `pipeline.ts`, use widening when `library === true` and none of the applied fixes use v7-only names (`finalStep`, `responseMessages`, `allowSystemInMessages`, `instructions`). Otherwise fall back to a full bump.
- In `pr-body.ts`, when widened, replace the "drops support for AI SDK 6" sentence with "Adds AI SDK 7 support; v6 users are unaffected."
- Tests: `test/bump.test.ts` cases for widen on, widen off, ranges that already allow 7, and `workspace:`/`catalog:` left alone.
- **Done when** tests pass, and a re-run on one deps-only library (e.g. zeabur/ai-sdk) produces a widened peer range with green gates.

### WP5. Support pnpm `catalog:` (dsh, ~2 hours)
4 repos were skipped because their `ai` range is `catalog:`.
- In `src/bump.ts` and `src/scan.ts` `findAiPackages`, when the range is `catalog:` or `catalog:<name>`, resolve it from `pnpm-workspace.yaml` (`catalog:` / `catalogs.<name>:`) and bump it there with a text-preserving edit.
- In `discover`/`triage`, treat a catalog-resolved `^6` as on v6.
- Tests with a fixture `pnpm-workspace.yaml`.
- **Done when** paulsilcock/litmus and telemetry-dev/telemetry get past `prepare`.

### WP6. A new batch of targets, chosen for merge likelihood (any + Jayanth; ~half a day)
- Run `discover` and `triage` for a fresh `data/targets-<date>.json`. Add npm search keywords `vercel-ai-sdk`, `ai-sdk-provider`, `ai-sdk-tools`, `useChat`, `ai-agent`, filtering on the `ai` range.
- Score each candidate (this needs `GITHUB_TOKEN`; run on Jayanth's machine). Add a small `src/score-targets.ts` that writes the scores into the targets file:
  - +3 if the repo merged a PR from a non-member in the last 60 days
  - +2 if it has `break` or `silent` findings (a code-change PR)
  - +1 if CI runs on fork PRs without approval
  - −2 if the last commit is more than 60 days old
  - −3 if it's already on v7
  - skip if it's already in `data/prs.csv`
- Take the top 20 through `prepare`. Deterministic-only repos go straight to drafts. Agent-needing repos go through `finish --judge` under WP2's thresholds.
- **Done when** there's a ranked targets file and up to 20 new drafts in `drafts/`, each with `status.txt`.

### WP7. Audit mode for repos that already migrated (dsh, ~half a day)
Goal: 12 of 45 repos migrated to v7 themselves. Find the silent bugs they kept, such as multi-step `usage` reads that now mean totals.
- Add `shim audit <dir>`: run the multi-step and `response.messages` rules against a v7 codebase. On v7, a `result.usage` read on a multi-step call is ambiguous rather than certainly wrong, so report it as "check" with the v6-vs-v7 meaning spelled out.
- Output an issue draft (`audit.md`), not a patch. A maintainer decides whether totals or the last step is what they want.
- Tests in `test/scan.test.ts` with a v7 fixture: a multi-step usage read is flagged as "check", and a single-step read is not flagged.
- **Done when** `shim audit` runs on the 12 self-migrated repos and writes `drafts/audit/<o>__<r>/audit.md` for any with findings. Jayanth decides which to post.

### WP8. Issue drafts for the 7 open-issue outcomes (dsh)
For each `outcome=open-issue` row in `data/overnight-2026-10-28/scale-results.csv`, write `drafts/issues/<o>__<r>.md` (≤15 lines): which v7 change breaks what (file:line), why the codemod doesn't fix it, a suggested fix, and an offer to send a PR. No fluff. Jayanth posts.

### WP9. Finish the 4 unfinished scale repos (pipeline)
`scripts/scale-one.sh` for Ryrahul/Vendure-ai, agentmail-to/agentmail-toolkit, silverprotocol/typescript-sdk, vargHQ/sdk. Run after WP2 if on DeepSeek.

### WP10. Architecture evolution (pipeline; later)
Follow `docs/evolve-runbook.md` (8-repo dev set, 5-repo holdout, budget cap). Not before WP2. If the judge runs on DeepSeek, start a fresh archive. Adopt the winner as `DEFAULT_ARCH` only if it beats v2 on the holdout.

### WP11. Fix the 5 container-only test failures (dsh)
Run `npm test` on Jayanth's machine. If they pass there, mark them with a clear reason or make them robust to the cloud container's filesystem (likely hard links or git config). Never skip a test just to get green. **Done when** `npm test` is green on Jayanth's machine and the cause is written in the commit message.

### WP12. Vercel codemod bug report (Jayanth decides)
Re-check `data/overnight-2026-10-28/vercel-codemod-google-rename.md` against the latest `@ai-sdk/codemod`. If it still reproduces, Jayanth or Shekhar files it. It's a good first contact with Vercel.

## 9. How a PR gets opened

1. The draft is ready: gates are green against baseline, the judge approved, `status.txt` says ready, and `pr.md` claims only what the patch does.
2. Jayanth forks the target repo (once).
3. `npx tsx src/cli.ts pr open drafts/<o>__<r> --fork JayanthMalladi`. This replays the patch on branch `shim/ai-sdk-7` and prints a compare URL. If upstream moved, re-run the draft rather than passing `--allow-drift`.
4. Jayanth reads the diff on GitHub and clicks **Create**.
5. `npx tsx src/cli.ts pr record <o/r> <pr-url>` adds the row to `data/prs.csv`. Commit it.
6. When a maintainer comments, Jayanth pastes the comment to an agent, which drafts a reply and any fix. Fixes are pushed to the fork branch; Jayanth posts the reply.

## 10. Gotchas
- **pnpm 11** silently runs `pnpm install` with lifecycle scripts before `pnpm run` unless `npm_config_verify_deps_before_run=false`. `targetEnv()` sets it. Don't remove it.
- Kill explicit PIDs. `pkill -f` can match your own shell.
- Monorepos take about 2 GB each. Delete clones after `finish` (`scale-one.sh` does).
- Drafts drift as upstream moves. `pr open` refuses unless `--allow-drift`.
- The cloud Claude container can't reach the GitHub API for other people's repos. Run `pr status` locally or rely on the refresh workflow.
- Plan usage limits interrupt long Claude runs. `runClaude` waits for the reset. Mark interrupted runs invalid and rerun them.
- Run the evolution from a frozen checkout, so edits don't change a variant mid-run.
- Windows works (cross-spawn, LF-normalized patches, EBUSY retries), and Jayanth runs Shim on Windows (`D:\shim`). Use forward-slash paths in code and `path.join` everywhere.
