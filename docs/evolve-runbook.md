# Prompt: run Shim's architecture evolution on an Anthropic API key

Paste everything below the line into Claude Code (or another coding agent) on the machine that will run the evolution.

---

You are running the architecture evolution for **Shim** (https://github.com/JayanthMalladi/shim). Shim turns API breaking changes into tested PRs; its first migration is Vercel AI SDK 6 → 7. Your job is to find the best fix-stage architecture with a fixed budget, prove it on held-out repos, and propose it as the new default. Work carefully: every evaluation spends real money.

Read `CLAUDE.md`, `README.md`, `src/evolve.ts`, `src/arch.ts`, `src/agent.ts`, `src/pipeline.ts` and `src/exec.ts` before doing anything else. `CLAUDE.md`'s rules apply throughout.

## What you're optimizing

The fix stage is a genome (`Architecture` in `src/arch.ts`): parallel candidates, attempts, fixer model and turns, fixer rules text, audit mode, an internal reviewer, reviewer feedback rounds, whether the fixer may run the repo's checks, and candidate selection. Seeds: `v1-single-retry`, `v2-parallel-review` (the current default), `v3-review-feedback-audit` and `v4-fixer-runs-checks`. After the seeds, an LLM mutator proposes children of strong parents.

- **Score** = repos where the variant opens a PR (every gate that passed at baseline still passes, no breaking findings) **and** the fixed judge approves the diff.
- **Ties** break on fewer false passes (gates passed, judge rejected), then lower cost.
- **The judge never changes during a run** (`JUDGE_RULES` and `runJudge` in `src/agent.ts`). Don't edit it. If it must change, start a fresh archive, because scores across judge versions are not comparable.

## Budget: confirm with me before spending

- **Total budget:** **$[BUDGET] USD**. Stop starting new evaluations once spent plus the next evaluation's estimate would exceed it.
- **Cost reference** (from runs on 2026-10-28, already at API rates):
  - v1 costs about $1.40–3 per repo.
  - A v2-style genome (3 candidates, reviewer) costs roughly 2–3× v1 per repo.
  - The judge adds about $0.30–0.60 per PR-producing repo.
  - On the 8-repo dev set below, expect about $15–25 for v1, about $40–60 each for v2–v4, and about $40 per mutated child.
  - A meaningful run is about $300+: the 4 seeds, 3–5 children, then the holdout check.
- **First, prove the cost model on v1:** run v1 on the dev set. Then tell me the real per-repo costs and a revised projection, and wait for my go-ahead before the remaining seeds.

## Machine

- **OS:** Linux or macOS (on Windows, use WSL2). It must be a box that stays up: a container restart cost 3 hours last time.
- **Tools:** Node ≥22, git, npm, and pnpm/yarn/bun if targets need them (`corepack enable` covers pnpm/yarn). You also need the `claude` CLI (Claude Code), because Shim calls `claude -p` for the fixer, reviewer, judge and mutator.
- **Disk:** ≥40 GB free. Candidate copies hard-link `node_modules`, but monorepo installs are large.
- **Auth:** export `ANTHROPIC_API_KEY`, and make sure `ANTHROPIC_AUTH_TOKEN` and any `claude` login profile aren't shadowing it.
  - Verify with `claude -p "reply ok" --model claude-sonnet-5-5 --output-format json`. The JSON must include `total_cost_usd`, which is how Shim sums cost.
  - `src/exec.ts` passes the environment through to `claude` unchanged.
- **Session:** run long jobs under `tmux` or `nohup`, and log to files.

## Phase 0: guardrails (code changes, before any spend)

Make these on a branch named `evolve-guardrails`. Each one gets tests, `npm test` and `npm run typecheck` must pass, and each goes in its own commit.

1. **Budget stop in `src/evolve.ts`.** Add a `--budget-usd <n>` flag. Before starting an evaluation, add up `cost` across `archive.jsonl` plus partial costs in `runs/<id>/*/result.json` for the in-flight evaluation. If that plus an estimate of the next evaluation (the parent's cost, or the most expensive seed so far, when the parent is unknown) would exceed the budget, log it and exit cleanly. Also count the mutator's own `claude` call toward spend.
2. **Model allowlist.** Reject or clamp any genome whose `fixerModel` or `reviewerModel` isn't one of `claude-opus-5-5`, `claude-sonnet-5-5` or `claude-haiku-5-5`, and tell the mutator the allowed list in its prompt. **Never use `claude-fable-5-1`, or any Fable or Mythos model.** The mutator itself stays on `claude-opus-5-5`.
3. **Bound the genome.** Clamp `candidates` to 1–4, `attempts` to 1–3, `fixerMaxTurns` to ≤60 and `reviewRounds` to ≤2, so one bad mutation can't spend the whole budget.
4. **Durable results.** Add a `--commit-results <dir>` flag, or a small wrapper script. After every evaluation it copies `LOG.md` and `archive.jsonl` into that directory inside a git checkout, commits, and pushes to a results branch, so results survive the machine dying.

Push the guardrails branch and open a PR into `main` with a short description. Run the evolution from this branch.

## Phase 1: build the bench (no agent spend)

`prepare` runs everything before the fix stage: baseline gates, version bump, official codemod and Shim's deterministic rewrites. It calls no model.

For each target, clone its default branch to `<bench>/<owner>__<repo>/repo`. Then run:

```
npx tsx src/cli.ts prepare <bench>/<key>/repo --out <bench>/<key> --repo <owner>/<repo>
```

That writes `<bench>/<key>/prepared.json`. If `prepare` reports `skip` (the repo has moved to v7, the install fails, and so on), drop the repo and tell me. Record each clone's HEAD sha in `<bench>/HEADS.txt`. Installs always use `--ignore-scripts`, because target repos are untrusted code.

**Dev set (8).** These were picked because they separate architectures: each failed at least once for a reason a better fix stage could address.
- `aorizondo/opencode-claude-code-acpbridge`: system messages built in helpers
- `jodit/jodit-ai-adapter`: formatter and unrelated-edit risk
- `ChainFuse/packages`: `ToolLoopAgent` with system messages, in tests
- `echoVic/blade-agent-sdk`: the codemod renamed `fullStream`; tests mock the old shape
- `ashwinpaulallen/ottrix`: needs a type-only test edit (`context` in tool options)
- `HoudiniSwap/houdiniswap-agent`: the monorepo root `@ai-sdk/*` bump
- `yadimon/prio-llm-router`: multi-step reads behind options built elsewhere
- `KrzysztofMarmol/mjml-agent-editor`: a usage-field remap and tool generics

**Holdout set (5), never shown to the mutator:** `neurophic/neurophic-sdk-js`, `upstash/context7`, `muxinc/ai`, `frayme-ai/frayme-sdk`, `nkwib/toolroute`.

## Phase 2: evolve on the dev set

```
npx tsx src/evolve.ts --bench <bench> --repos <8 dev keys, comma-separated> --out <out> --set dev \
  --hours <N> --concurrency 2 --budget-usd <BUDGET minus holdout reserve> --mirror <results checkout>
```

- **Evaluation order:** the loop evaluates seeds first (v1, v2, v3, v4), then mutated children. It resumes interrupted evaluations and a pending child on restart, so if it dies, rerun the same command.
- **Holdout reserve:** keep enough budget for Phase 3, about 3 architectures × 5 repos.
- **Invalid runs:** runs marked `INVALID` (rate limits, or errors such as `overloaded_error`) don't count, and the loop pauses 20 minutes after one. If more than 2 in a row are invalid, stop and diagnose the environment rather than burning budget.
- **Read `LOG.md` after every evaluation.** Check each judge rejection: is it a real behavior problem, or noise? If the judge looks wrong on a repo, report it with the evidence and leave it alone. Don't change it mid-run.
- **Watch for cheating:** casts or `@ts-ignore`, deleted or weakened tests, public-type annotations, reformatted untouched code. The judge should reject these. If one ships anyway, that's a judge gap to report.

## Phase 3: check on the holdout

The dev set is small, and the mutator sees its results, so the dev score overfits. For v1, v2 (the current default), the best other seed and the top 2 children, run each on the holdout set:

```
npx tsx src/evolve.ts --bench <bench> --repos <5 holdout keys> --out <out> --set holdout --only <arch id>
```

**Pick the winner by:** holdout shipped, then dev+holdout shipped, then fewest false passes, then **cost per shipped PR**. If the winner beats v2 by less than one repo on the combined set, call it a tie and keep the cheaper genome.

## Phase 4: adopt

Open a PR into `main` that sets `DEFAULT_ARCH` in `src/arch.ts` to the winning genome. The description should hold:
- the dev and holdout tables, per repo
- total spend
- cost per shipped PR, old vs new
- what the winning mutation changed
- every judge-rejection reason seen on the winner

Keep it short and specific.

## Hard rules

- Never open PRs, issues or comments on target repos, and never push to them. This run only measures.
- Never use a Fable or Mythos model. Never edit the judge during a run.
- Never mix results across judge versions or bench snapshots in one archive.
- Target repos are untrusted: no lifecycle scripts, and no running their code outside Shim's gates.
- If a run looks wrong (the score jumps by more than 3 repos, the cost is wildly off, or every repo errors), stop and investigate before continuing.

## Report back

1. After Phase 1: bench status per repo and the HEAD shas.
2. After v1: real costs and the revised projection, then wait for my go-ahead.
3. At the end:
   - the final `LOG.md` tables (dev and holdout)
   - the winner and why
   - total spend
   - cost per shipped PR, old vs new
   - judge gaps or Shim bugs found
   - links to the guardrails PR and the adopt PR
