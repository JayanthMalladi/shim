# Shim

Start with `docs/SPEC.md`: current status, architecture, and the work packages (WP0–WP12) with acceptance criteria.

Shim turns API breaking changes into tested PRs. First migration: AI SDK 6 -> 7.

## Commands
- `npm test` runs vitest. `npm run typecheck` runs tsc.
- `npx tsx src/cli.ts scan|fix|migrate <dir> [--migration <id>]`. `--migration` selects the entry in `MIGRATIONS` (`src/migrations.ts`); without it, `ai-sdk-v7` is the default. The `zod-v4` entry's `scan` is `scanZodV4` (`src/rules/zod-v4.ts`, rules R1-R8, static-only — no type-checker calls), `applyAutoFixes` is shared with ai-sdk-v7, and `bumpZod` rewrites the exact `zod` dep to ^4.0.0. The agent prompt fields on the `zod-v4` entry are T4 placeholders.
- The `express-v5` entry's `scan` is `scanExpressV5` (`src/rules/express-v5.ts`, rules E1-E10, static-only — no type-checker calls), `applyAutoFixes` is shared with ai-sdk-v7, `bumpExpress` rewrites `express` -> ^5.0.0 and the matching `@types/express`/`@types/express-serve-static-core` to ^5.0.0, and the codemod is the official `@expressjs/codemod` (4 transforms, run in `src/express-codemod.ts`).
- `npx tsx src/cli.ts prepare <dir> --repo owner/name --out <d>` caches baseline, bump, codemod and deterministic fixes (no model calls). `finish <dir> --prep <d>/prepared.json --out <d> [--arch <id>] [--judge]` runs the fix stage.
- `npx tsx src/cli.ts pr open <draft-dir> --fork <forkOwner> [--allow-drift]` replays a draft on a fork branch and prints the compare URL. `pr record <owner/repo> <pr-url>` logs it. `pr status` refreshes `data/prs.csv`. `stats` regenerates `site/lib/stats.json`.
- `npx tsx src/evolve.ts --bench <dir> --repos a__b,c__d --out <dir> --set dev|holdout --hours N --concurrency 2 --budget-usd <n> [--only <archId>] [--mirror <dir>]` runs the architecture evolution loop.

## Rules
- Fixes must preserve the target repo's current runtime behavior. Prefer a deterministic rewrite in `src/rules/` over the agent.
- Every new rule gets a fixture case in `test/fixtures/v6-app` and an assertion in `test/scan.test.ts`, including a case that must not be flagged.
- Never open a PR unless every gate that passed at baseline still passes (`src/gates.ts`). Otherwise write an issue draft (see "Issue drafts" below). Never post it yourself.
- Installs of target repos always use `--ignore-scripts`.
- Keep replies and PR text short and specific; maintainers skim.
- Agents never open, close, edit or comment on PRs or issues on target repos, with any tool (`gh`, the API, MCP) or account. `shim pr open` pushes to Jayanth's fork, and Jayanth clicks Create. Never open a second PR on a repo already in `data/prs.csv`. Agent runs must not hold a GitHub token that can write outside `JayanthMalladi/shim` and Jayanth's forks.
- Never use a Fable or Mythos model in the pipeline or the evolution. The allowlist is in `src/evolve-guard.ts`.
- This repo is public. Never commit secrets. `src/exec.ts` strips API keys from target-repo commands; keep it that way.

## Issue drafts
When a repo gets an issue instead of a PR, the agent writes a draft and stops there. A reviewer checks the draft, and Jayanth posts the ones that pass.
- One file per repo: `drafts/issues/<owner>__<repo>.md`. `drafts/` is gitignored; drafts never go in this public repo. Line 1 is `Title: ...`, then a blank line, then the body.
- 15 lines or fewer. Include the `file:line`, which v7 change breaks it (and what it does at runtime), why the codemod and tsc miss it, the suggested fix, and an offer to send a PR.
- Only write a draft when there is a concrete finding in the repo's code. "Gates regressed", "no green gate at baseline" and "reviewer gave no verdict" are Shim's problems, not the maintainer's. Log them in the run results, not in a draft.
- No Shim internals (pipeline rule, fix stage, reviewer, WP numbers, scale pass), no boilerplate list of every v7 change, and no links except the repo's own files. One plain "found while upgrading to AI SDK 7" line is enough.
- Skip repos that already have a Shim PR in `data/prs.csv`. Put anything new for them in a draft reply on that PR.
- Write files as UTF-8 with a file-write tool, never `echo` or a shell heredoc that interprets escapes. Before handing it off, check the file for `â€`, `â†`, control characters, and backticked names missing their first letter (e.g. `ole` for `role`).
- If an existing issue must be closed, Jayanth does it, as "not planned" with: "Closing: this was posted in error by an automated run. Sorry for the noise."

## Coding guidelines (Karpathy)
Always follow these when writing, reviewing or refactoring code in this repo. Claude sessions should also load the `karpathy-guidelines` skill. Agents without skills (dsh) follow the text below. They favor caution over speed; use judgment on trivial tasks.

1. **Think before coding.** State your assumptions. If a request can be read more than one way, say so instead of picking silently. If a simpler approach exists, say so. If something is unclear, stop and name what's confusing.
2. **Simplicity first.** Write the minimum code that solves the problem. No features, abstractions, configurability or error handling for impossible cases that nobody asked for. If 200 lines could be 50, rewrite it.
3. **Surgical changes.** Touch only what the task needs. Don't reformat or "improve" adjacent code, and match the existing style. Mention unrelated dead code instead of deleting it. Remove only the imports, variables and functions your own change made unused. Every changed line should trace to the request.
4. **Goal-driven execution.** Turn the task into checks you can verify: write a test that reproduces the bug, then make it pass; run `npm test` and `npm run typecheck` before and after a refactor. For multi-step work, write a short plan with a verify step for each item, and loop until each check passes.

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
