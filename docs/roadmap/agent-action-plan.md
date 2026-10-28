# Shim action plan for coding agents

As of 2026-10-28. This is the reference for any coding agent working on Shim. Each task is self-contained: why, files, the change, tests, done-when, and what not to touch. Pick a task by ID, read its dependencies, and follow the global rules.

Humans: the tasks marked **Human** are yours. Everything else can be handed to an agent with the prompt template at the end.

---

## 0. Global rules (every task)

Read `CLAUDE.md` and `README.md` before starting. These rules come from `CLAUDE.md` plus lessons from the Oct 27–28 runs.

**Code**
1. Fixes must preserve the target repo's current runtime behavior. Prefer a deterministic rewrite in `src/rules/` over the agent.
2. Every rule change gets a fixture case in `test/fixtures/v6-app`, an assertion in `test/scan.test.ts`, **and a case that must not be flagged**.
3. `npm test` and `npm run typecheck` must pass before every commit. Make one commit per task, with a short, specific message.
4. Match the surrounding code: comment density, naming, the existing helpers (`run`, `runCapture`, `runAsync` in `src/exec.ts`; `log()`; `readPkg`). No new runtime dependencies without saying why in the commit message.
5. Never weaken a test, skip a test, or add `as any` / `as unknown as` / `@ts-ignore` to get green.

**Target repos (untrusted code)**

6. Installs of target repos always use `--ignore-scripts`.
7. Never open PRs, issues or comments on target repos, and never push to them. Humans open PRs.
8. Never run a target repo's code outside Shim's gates.

**Agent spend**

9. Tasks marked with a spend estimate run headless `claude` agents and cost real money. Respect the stated cap. Stop and report on any environment failure, retrying at most once. Report the actual cost.
10. Never use Fable or Mythos models. The fixer, reviewer and judge use `claude-opus-5-5`, `claude-sonnet-5-5` or `claude-haiku-5-5` only.
11. Never edit the judge (`JUDGE_RULES` and `runJudge` in `src/agent.ts`) unless the task says so. A judge change invalidates every evolution score before it.

**Git**

12. Work on the branch the task names. Never force-push a shared branch. Never run `git checkout -- .`, `git reset --hard` or `git stash` on a working tree that has someone else's changes.
13. `drafts/` lives only on `claude/serene-babbage-yzfhbn`. Never merge it into `main`.
14. Never commit secrets. Keys go in environment variables, never in files.

**Writing**

15. PR text and commit messages are short and specific; maintainers skim. Never claim a fix the diff didn't make.

---

## 1. Repo map

| Path | What it does |
| --- | --- |
| `src/cli.ts` | Entry point: `scan`, `fix`, `migrate`, `prepare`, `finish`, `triage`, `discover` |
| `src/pipeline.ts` | `prepare()` (baseline, bump, codemod, deterministic fixes; no agent), `finish()` (fix stage, gates, judge, verdict), `migrate()` (both), `formatChanged()`, `addChangeset()` |
| `src/gates.ts` | `install()` (always `--ignore-scripts`), `runGates()` (build, then per-package typecheck/test, max 12 packages), `regressions()` |
| `src/scan.ts` | `loadProject()` / `scan()` / `scanAndFix()`: loads source files into ts-morph, runs the rules |
| `src/rules/ai-sdk-v7.ts` | All AI SDK 6→7 rules and their auto-fix edits |
| `src/codemod-guard.ts` | Flags repo exports the official codemod renamed |
| `src/bump.ts` | `bumpAiSdk()`: bumps `ai` and `@ai-sdk/*` in every package.json |
| `src/candidates.ts` | Parallel fixer candidates in copies, ranking, adopting the winner |
| `src/agent.ts` | `runFixer`, `runReviewer`, `runJudge`, plus their prompt rules |
| `src/arch.ts` | The fix-stage genome (`Architecture`), seeds V1–V4, `DEFAULT_ARCH` (= V2), `FIXER_RULES`, `REVIEWER_RULES` |
| `src/evolve.ts` | The architecture evolution loop (see `docs/roadmap/evolve-runbook.md`) |
| `src/pr-body.ts` | `prBody(report, patch?)`: the PR description |
| `src/rerender-drafts.ts` | Re-renders saved drafts' `pr.md` from `report.json` + `changes.patch` |
| `src/exec.ts` | `run`, `runCapture`, `runAsync`, `runClaude` (waits out usage limits); `SAFE_ENV` |
| `src/copy.ts` | `copyRepo()` with hard-linked `node_modules` |
| `src/triage.ts`, `src/discover.ts` | Find npm packages on `ai@6`, clone, read-only scan |
| `src/types.ts` | `Finding` (`ruleId`, `severity`: break/silent/deprecated, `fix`: auto/agent/manual), `ScanResult` |
| `test/*.test.ts` | vitest: scan, fixer, bump, codemod-guard, pr-body |
| `test/fixtures/v6-app/` | The fixture app every rule is tested against |
| `site/` | Landing page (Next.js static export); links and placeholders in `site/lib/site.ts` |
| `data/prs.csv` | Every upstream PR Shim opened (columns: repo, stars, last_commit, pr_url, opened_at, state, merged_at, comments, notes) |
| `data/scale-results-2026-10-27.csv`, `data/evolve-log-2026-10-27.md` | Results of the first overnight scale run and the first evolution run |
| `drafts/` (only on `claude/serene-babbage-yzfhbn`) | PR drafts per target repo, plus `SUMMARY.csv` and `READY.md` |

## 2. Current state

- **`main` (363d9a1):** fixes A–J, the landing page, 45 tests.
- **Drafts:** 12 ready, 4 needs-review, 5 not-ready. See `docs/roadmap/status-and-open-now.md`.
- **One upstream PR is open:** requestyai/ai-sdk-requesty#66.
- **Unmerged branches with known bugs:** `evolve-guardrails` (T2) and `fix/gitignored-scan` (T1).
- **Agent budget:** about $45 left. Agent-spend tasks must state and respect a cap.

## 3. Task index

| ID | Task | Priority | Depends on | Agent spend | Branch |
| --- | --- | --- | --- | --- | --- |
| T0 | Strip secrets from target-repo commands' environment | P0 | none | $0 | `fix/target-env` |
| T1 | Fix the gitignored-scan branch (silent zero-file scan, `-z`) | P0 | none | $0 | `fix/gitignored-scan` |
| T2 | Fix the evolve-guardrails branch (double count, mirror push, mutate before budget) | P0 | none | $0 | `evolve-guardrails` |
| T3 | `shim pr open` | P0 | none | $0 | `feat/pr-open` |
| T4 | `shim pr status` | P0 | none | $0 | `feat/pr-status` |
| T5 | CI Node-version rule | P0 | none | $0 | `feat/ci-node-rule` |
| T6 | Rerun the 6 held repos | P0 | T0, T1, T5 merged | ≤ $25 | `claude/serene-babbage-yzfhbn` |
| T7 | Prepare the CLI for publishing under a scope | P0 | Human H3 (scope) | $0 | `feat/publish-cli` |
| T8 | Draft the venice issue text | P0 | none | $0 | `claude/serene-babbage-yzfhbn` |
| T9 | Guard against codemod edits on non-SDK symbols | P1 | T1 | $0 | `feat/codemod-symbol-guard` |
| T10 | Per-test baseline comparison | P1 | none | $0 | `feat/per-test-gates` |
| T11 | pnpm `catalog:` support | P1 | none | $0 | `feat/pnpm-catalog` |
| T12 | Required `context` in tool execution options | P1 | none | $0 | `feat/tool-context-rule` |
| T13 | Secret scan on drafts | P1 | none | $0 | `feat/drafts-secret-scan` |
| T14 | `shim pr followup` | P1 | T3 | per run, ≤ $5 | `feat/pr-followup` |
| T15 | PR-body "Fixed" matching by rescan | P2 | none | $0 | `feat/fixed-by-rescan` |
| T16 | Typed-result rule through the type checker | P2 | none | $0 | `feat/typed-result-checker` |
| T17 | Hunk-limited eslint fixes | P2 | none | $0 | `feat/eslint-hunks` |
| T18 | Provider spec v3 → v4 | P1 after Nov 2 | research doc first | $0 | `feat/provider-spec-v4` |
| T19 | Evolution run | P2 after Nov 2 | T1, T2, T9, T10 merged; H7 | $150–300+ | `evolve-guardrails` + results branch |
| T20 | Judge economics (cheap judge for deps-only, consistency check, cost per PR) | P2 | T2 | small | `feat/judge-economics` |
| T21 | Silent-bug scan for repos already on v7 | P1 | none | $0 | `feat/scan-v7` |
| T22 | Sandboxed gates | P2 | T0 | $0 | `feat/sandbox` |
| T23 | GitHub App prototype | P2 after Nov 2 | T3, T4 | $0 | `feat/github-app` |

**Human tasks:** H1–H8 (section 7).

---

## 4. P0 tasks (before Nov 2)

### T0: Strip secrets from target-repo commands' environment

**Why:** `src/exec.ts` builds `SAFE_ENV` as `{ ...process.env, CI: "1", ... }`, and every command gets it. That includes target repos' install, build, typecheck and test scripts. So untrusted code from a target repo can read `ANTHROPIC_API_KEY`, `GITHUB_TOKEN` and anything else in the environment and send it out. This is the highest-risk issue in the codebase.

**Change:**
- Split the environment in two:
  - `TARGET_ENV`, for anything that runs target-repo code: `install`, `runGates`, formatters, eslint, the codemod, `npx` in target dirs.
  - `AGENT_ENV`, for `runClaude` only. It keeps what `claude` needs.
- `TARGET_ENV` = `process.env` minus every variable matching `/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i`, plus `ANTHROPIC_*`, `CLAUDE_*`, `AWS_*`, `GH_*`, `GITHUB_*`, `NPM_TOKEN` and `NODE_AUTH_TOKEN`. Keep `PATH`, `HOME`, `CI`, `FORCE_COLOR`, `npm_config_verify_deps_before_run` and proxy variables (`HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`), plus their lowercase forms.
- Thread the choice through `run`, `runCapture` and `runAsync` with an optional `env` argument. The default is `TARGET_ENV`, so a forgotten call site fails safe. `runClaude` passes `AGENT_ENV`.
- The fixer agent still runs the repo's checks when `fixerChecks` is on. Note in a comment that the agent's own Bash tool inherits `AGENT_ENV`; T22 covers that later.

**Tests:** a unit test that `TARGET_ENV` drops `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `FOO_SECRET` and `MY_API_KEY`, and keeps `PATH`, `HTTPS_PROXY` and `CI`. Also a test that `run("node", ["-e", "console.log(process.env.ANTHROPIC_API_KEY ?? 'unset')"])` prints `unset` when the parent has it set.

**Done when:** no call path that runs target code can see an API key, and the tests pass.

**Don't:** change how `claude` authenticates.

### T1: Fix the gitignored-scan branch

**Branch:** `fix/gitignored-scan` (c52f94d: the scanner loads `git ls-files -co --exclude-standard`).

**Bug 1 (major, reproduced):** say the scan root has no `.git` of its own but sits inside another repo's ignored directory (for example Shim's own `work/`). Then `git ls-files` succeeds against the outer repo and returns nothing. The result is **0 files, 0 findings**, which looks like a clean repo.

**Fix:** trust git's list only when `git rev-parse --show-toplevel` (realpath) equals the scan root (realpath). Otherwise walk the filesystem.

**Bug 2 (minor):** git quotes non-ASCII paths by default, so those files are silently dropped. Use `git ls-files -z -co --exclude-standard` and split on `\0`.

**Tests:** add to the existing "source file loading" block in `test/scan.test.ts`:
- A git repo whose `.gitignore` ignores `work/`, with a non-git folder `work/x/src/a.ts` holding a trigger call. `scan(work/x)` must flag it.
- A tracked file with a non-ASCII name (`src/übung.ts`) must be scanned.

**Done when:** the existing 4 tests and the 2 new ones pass. Rebase on `main` if needed, then merge into `main` (fast-forward or merge commit, no history rewrite).

### T2: Fix the evolve-guardrails branch

**Branch:** `evolve-guardrails` (4 commits: budget stop, model allowlist, genome bounds, `--mirror` commit/push).

**Bug 1 (major):** `spentSoFar(archId)` in `src/evolve.ts` adds every `runs/<archId>/*/result.json`. That folder isn't split by repo set, and results from runs already in `archive.jsonl` are counted again. This happens on `--only <id> --set holdout` (the runbook's step 3, the holdout check) and when an INVALID evaluation is rerun. The result is a premature "budget reached".
- **Fix:** count an in-flight `result.json` only if its mtime is later than the newest archive entry for that arch id (any set).
- **Testability:** move this into `src/evolve-guard.ts` as a pure function taking `(archiveEntries, resultFiles: {path, mtimeMs, cost}[])`.

**Bug 2 (moderate):** `syncMirror` commits and runs `git push origin HEAD` on whatever branch the mirror's repo is on. A mirror folder inside the Shim checkout on `main` would push to `main` after every evaluation.
- **Fix:** only commit and push when `git rev-parse --show-toplevel` equals the mirror folder and the current branch is not `main`, `master` or the remote's default branch. Otherwise copy only, and log why.

**Bug 3 (minor):** the loop calls `mutate()`, which spends money, before `withinBudget()`. Check `spentSoFar() >= budgetUsd` before calling `mutate()`.

**Bug 4 (minor):** `estimateNext` takes the max over every parentless entry, including other sets and invalid runs. Restrict it to non-invalid entries of the current set; with none, use the per-repo average of any set × `repos.length`.

**Nits:**
- Remove the double blank lines in `src/evolve-guard.ts`.
- Stop building the same archive entries twice in `withinBudget` and `spentSoFar`.
- Make the `syncMirror` test assert the commit exists on the bare remote (`git --git-dir <origin> log`), not just locally.

**Tests:** unit tests for the new pure spend function covering a holdout `--only` rerun, an invalid rerun and a fresh run; a mirror-refuses-`main` test; a test that mutate isn't called when over budget (inject a fake mutator if needed).

**Done when:** all tests pass and the branch merges into `main` cleanly.

### T3: `shim pr open`

**Why:** opening each PR by hand takes about 10 minutes and invites mistakes: a wrong base, a forgotten log row, a second PR on a repo that already closed one.

**Command:** `shim pr open <drafts/owner__repo> --fork <forkOwner>`

1. Read `status.txt`, `pr.md` and `changes.patch` from the draft folder, and the upstream `owner/repo` from the folder name or `report.json`.
2. **Refuse** if `data/prs.csv` already has a row for this repo, whatever its state. The footer promises we never open a second PR.
3. Clone `https://github.com/<forkOwner>/<repo>` into a temp dir. Add `upstream`, fetch the upstream default branch, and create `shim/ai-sdk-7` from `upstream/<default>`.
4. Compare upstream HEAD with the `HEAD:` sha in `status.txt`. If they differ, warn, and stop unless `--allow-drift` is passed.
5. `git apply --3way changes.patch`. On conflict, stop and print "regenerate this draft".
6. Commit with message `Upgrade to AI SDK 7`, using the user's git identity, and push to the fork.
7. Print the compare URL `https://github.com/<owner>/<repo>/compare/<default>...<forkOwner>:<repo>:shim/ai-sdk-7?expand=1` and the path to `pr.md`.
8. Don't open the PR: a human clicks Create. Add `shim pr record <owner/repo> <pr-url>`, which appends the `data/prs.csv` row (`opened_at` = today, `state` = `open`).

**Tests:** a temp bare "upstream" and a bare "fork" (like the `syncMirror` test), a draft folder fixture, a refusal when a row exists, and the drift warning.

**Done when:** `shim pr open` works end to end against local bare repos in tests and prints the URL.

### T4: `shim pr status`

**Why:** the application numbers (opened, merged, replied, merge rate) must come from data, regenerated in one command on Nov 1.

**Command:** `shim pr status [--write]`
- For each `data/prs.csv` row with a `pr_url`, call the GitHub REST API with Node's `fetch`, no new dependency. Use `GITHUB_TOKEN` from the environment if set (unauthenticated allows 60 requests an hour, enough for about 25 PRs).
- Endpoints: `GET /repos/{o}/{r}/pulls/{n}` (state, merged_at, comments, review_comments) and `GET /repos/{o}/{r}/pulls/{n}/reviews`.
- Print a table: repo, state (open, merged or closed), days open, maintainer comments (excluding the PR author), and the latest review state.
- Then print totals: opened, merged, closed unmerged, any reply, and merge rate. Merge rate = merged ÷ opened, counting only PRs open at least 3 days.
- `--write` updates `state`, `merged_at` and `comments` in `data/prs.csv`.

**Tests:** mock `fetch` with fixture JSON for open, merged and closed PRs, then check the totals and the CSV rewrite. Commas and quotes in the notes column must survive.

### T5: CI Node-version rule

**Why:** AI SDK 7 requires Node 22. On Oct 28, 2 of the 12 ready PRs had PR-triggered CI on Node 18/20: toolroute (`node-version: '20'`) and apertis (matrix `[18, 20, 22]`). Those PRs go red on day one.

**Change:** a new check in `scan()` (next to `checkPackageJsons`), with rule id `ci-node-version`, severity `break` and fix `auto` where the rewrite is unambiguous.
- Read `.github/workflows/*.yml` and `*.yaml` as text, with no YAML dependency. Line-based edits keep formatting.
- Only consider workflows whose `on:` includes `pull_request` or `push`.
- **Rewrite** a scalar `node-version: 18`, `'20'`, `"20.x"` or similar to `22` (same quoting). Rewrite an inline list `[18, 20, 22]` by dropping entries below 22, and use `[22]` if none remain.
- **Don't rewrite:** `lts/*`, `latest`, `node`, `${{ … }}` expressions (resolve `matrix.<name>` only when the matrix is an inline list in the same job), or `node-version-file`. For `node-version-file`, read the file (`.nvmrc`, `.node-version`) and flag it, without an edit, if it's below 22.
- **PR body:** add a line under "What changed": "CI now runs on Node 22, which AI SDK 7 requires: `<files>`."

**Fixtures:** `test/fixtures/v6-app/.github/workflows/`:
- `ci.yml` with `node-version: '20'` and a `[18, 20, 22]` matrix (flagged and rewritten).
- `ok.yml` with `22`, `lts/*` and `${{ matrix.version }}` over `['lts/*', latest]` (**must not be flagged**).
- `publish.yml` triggered only by `release` with `node-version: 20` (**must not be flagged**).

**Done when:** both forms rewrite correctly, the must-not-flag cases stay untouched, and the README rules table has a row.

### T6: Rerun the 6 held repos (agent spend, cap $25)

**Depends on:** T0, T1 and T5 merged into `main`.

**Repos:** yadimon/prio-llm-router, neurophic/neurophic-sdk-js, upstash/context7, KrzysztofMarmol/mjml-agent-editor, HoudiniSwap/houdiniswap-agent, ashwinpaulallen/ottrix.

**Procedure:** the same as the Oct 28 draft batches.
1. Fresh shallow clone of the default branch HEAD into a scratch dir.
2. `npx tsx src/cli.ts prepare <dir> --out <dir> --repo <o/r>`, then `finish <dir> --prep <prepared.json> --out <dir> --judge`, with the default architecture.
3. **Ready** only if the verdict is `open-pr`, no baseline gate regressed, and the judge approved.
4. Read `changes.patch` and `pr.md` for anything that would earn `needs-review`:
   - unrelated edits
   - casts or `@ts-ignore`
   - deleted or weakened tests
   - public-type annotations
   - overclaims in the text
5. Copy `pr.md`, `changes.patch`, `report.json`, `result.json`, `judge.txt` and `status.txt` (with `HEAD: <sha>`) into `drafts/<owner>__<repo>/`.
6. Replace that repo's row in `drafts/SUMMARY.csv` and update `drafts/READY.md`.
7. Commit and push to `claude/serene-babbage-yzfhbn` after each repo, then delete the clone.

**Budget:** before each repo, stop if spent + 1.5 × its previous cost would exceed $25. Previous costs: yadimon 2.21, neurophic 4.71, context7 3.16, mjml 5.57, HoudiniSwap 3.34, ottrix 3.02.

**Report:** a table of status, kind, cost and judge verdict or reason, and whether the previous failure is fixed.

### T7: Prepare the CLI for publishing under a scope

**Why:** the npm name `shim` belongs to an unrelated polyfill package (v0.6.0), and our `package.json` is `"private": true`. So `npx shim scan .` on the landing page would run someone else's code.

**Depends on:** H3, the human choosing a scope. Until then, use the placeholder `@SCOPE/shim` and do not publish.

**Change:**
- In `package.json`: `"name": "@SCOPE/shim"`, remove `private`, set `"files": ["dist", "README.md"]`, keep `"bin": {"shim": "./dist/cli.js"}`, and add a `prepublishOnly` script (`npm run typecheck && npm test && npm run build`).
- Make sure `dist/cli.js` has a `#!/usr/bin/env node` shebang.
- `shim --version` prints the package version.
- `scan` works offline with no API key. `migrate --agent` fails fast with a clear message if `claude` isn't installed or authenticated.
- Replace every `npx shim` in `site/` (search `site/components`, `site/lib/site.ts`) and in `README.md` with `npx @SCOPE/shim`, defined in one constant in `site/lib/site.ts`.

**Tests:** `npm pack --dry-run` lists only `dist/` and the README. A smoke test runs the built `dist/cli.js scan test/fixtures/v6-app` and expects findings.

**Done when:** `npm pack` produces a working tarball and the site builds with the new command. **Do not run `npm publish`**; that's the human's step.

### T8: Draft the venice issue text

**Why:** dpuyosa/venice-ai-sdk-provider has a real break the maintainer must decide on, and `CLAUDE.md` says to open an issue when a PR isn't possible.

**Change:** write `drafts/dpuyosa__venice-ai-sdk-provider/issue.md` (under 200 words):
- Title: "AI SDK 7: provider types no longer match `@ai-sdk/openai-compatible@3`".
- Body:
  - the exact error (TS2352 at `src/venice-provider.ts:113`)
  - the cause: openai-compatible@3 returns v4-spec models while `VeniceProvider` is declared on the v3 spec
  - two options: migrate the provider interface to the v4 spec, or keep `@ai-sdk/openai-compatible` on `^2` for now
  - one line on how this was found, the same footer as the PRs, and no links to unrelated content

A human opens it (H1).

---

## 5. P1 tasks (engine quality)

### T9: Guard against codemod edits on non-SDK symbols

**Why:** the official codemod rewrites the repo's own names. In muxinc/ai it rewrote the project's own `TokenUsage` fields in 7 test files; it also hit `system` keys in raw HTTP bodies (ottrix), and `fullStream` was renamed while test mocks kept the old shape (echoVic). Gates missed all of it. The judge caught muxinc and echoVic, at a cost of about $5 in agent spend, and lost both PRs.

**Change:**
- In `prepare()`, after `bumpAiSdk` and before running the codemod, snapshot the tree with a temp commit (or keep a copy).
- After the codemod, take the codemod's diff and map each changed hunk to the identifiers or property names it renamed.
- Using a ts-morph project on the **pre-codemod** snapshot, with real type info (baseline already ran `install`, so `node_modules` exists), resolve each renamed symbol. Do this in this order:
  1. Look up the declaration. If it's in `node_modules/ai` or `node_modules/@ai-sdk/*`, keep the edit.
  2. Otherwise revert that hunk, and add a finding `codemod-non-sdk-edit` (severity `break`, fix `manual`) naming file:line and the symbol.
- **Research first:** list the transforms in `@ai-sdk/codemod` v7 (`npm pack @ai-sdk/codemod@4` and read the transform sources) and document which ones rename identifiers, properties or object keys. Write the list in a comment at the top of the new module.

**Fixtures:**
- A local `interface TokenUsage { promptTokens: number }` used in a test file.
- A `fetch(url, { body: JSON.stringify({ system: "…" }) })` call.
- A mock returning `{ fullStream }`.

Each must keep its original text after `prepare`. An actual `streamText(...).fullStream` read **must** still be renamed.

**Done when:** rerunning `prepare` on muxinc/ai no longer touches `TokenUsage` fields (verify with a fresh clone, `prepare` only, no agent spend).

### T10: Per-test baseline comparison

**Why:** a check that's already red at baseline (echoVic's `test .`) hides new breakage, because `regressions()` only compares pass/fail per gate.

**Change:**
- In `runGates`, when the test script runs vitest or jest (detect from the script text or `devDependencies`), rerun the test gate with a JSON reporter:
  - vitest: `--reporter=json --outputFile=<tmp>`
  - jest: `--json --outputFile=<tmp>`
- Store the per-test results (id = file + full name, ok) in `GateResults`.
- `regressions()` reports a gate as regressed if any test that passed at baseline now fails or is missing, **even if the gate was red at baseline**.
- Other runners keep today's behavior.

**Tests:** fixture JSON outputs for both runners: a red-at-baseline gate where a previously passing test now fails (regressed), and one where only already-failing tests fail (not regressed).

### T11: pnpm `catalog:` support

**Why:** 3 repos were skipped at triage because their dependency ranges were `catalog:`.

**Change:**
- In `bumpAiSdk`, when a package.json uses `catalog:` or `catalog:<name>` for `ai` or `@ai-sdk/*`, find the version in `pnpm-workspace.yaml` (`catalog:` or `catalogs: <name>:`) and bump it there, with a line-based edit that preserves formatting.
- Keep the package.json references unchanged.
- Triage must stop reporting "not on ai@6 (catalog:)" when the catalog entry is `^6`.

**Tests:** a temp monorepo with a default catalog and a named catalog; one entry already allows the target major (no edit).

### T12: Required `context` in tool execution options

**Why:** ottrix's gated test typecheck failed after the upgrade on a `ToolExecutionOptions` literal missing `context`.

**Change:**
- First confirm the exact v7 type: `npm pack ai@7` and read `ToolExecutionOptions` in `dist/index.d.ts`.
- Then add a rule `tool-execution-context` (severity `break`, fix `agent`) that flags object literals passed as the second argument to a tool's `execute(...)`, or typed as `ToolExecutionOptions`, that lack the newly required field.
- The finding's message says the minimal type-only edit, which `FIXER_RULES` now permits in tests.

**Tests:** a fixture test file with the literal (flagged), and one already passing `context` (not flagged).

### T13: Secret scan on drafts

**Why:** `drafts/*/changes.patch` and `report.json` are committed to a public repo, so a target's leaked token in a diff would be republished by us.

**Change:**
- `shim drafts check [dir]` scans added lines in every `changes.patch` and every `report.json` for key patterns: `sk-ant-`, `sk-[A-Za-z0-9]{20,}`, `ghp_`, `github_pat_`, `AKIA[0-9A-Z]{16}`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`, `xox[bp]-`, and `"(api[_-]?key|secret|token)"\s*:\s*"[^"]{12,}"`.
- On a match it exits non-zero, printing the file and line, never the secret itself.
- Call it from `src/rerender-drafts.ts`, and document running it before any drafts commit.

**Tests:** fixtures with fake keys (built at runtime so the repo itself contains no key-shaped strings) and a clean patch.

### T14: `shim pr followup <pr-url>` (agent spend, ≤ $5 per run)

**Depends on:** T3.

**Change:**
- Fetch review comments and change requests through the GitHub API.
- Clone the fork branch and rerun `prepare` on it, skipping the bump if it's already applied.
- Hand the comments to `runFixer` as findings, under the same gates and judge.
- Write the new commit's patch to `drafts/<repo>/followup-<n>.patch`, and push to the fork branch only with `--push`.
- Print a one-paragraph reply for the human to post.

**Tests:** unit-test the comment-to-brief conversion with fixture API JSON. The agent run itself stays manual.

### T21: Silent-bug scan for repos already on v7

**Why:** 12 of the 45 v6 packages migrated by hand within about six weeks (see `data/scale-results-2026-10-27.csv`, the rows "not on ai@6 (^7…)"). Hand migrations may have shipped the silent changes. A real hit is the strongest demo for the application.

**Change:**
- Add `shim scan --since v6 <dir>`, which runs the silent-change rules on v7 code: multi-step `result.usage` / `toolCalls` / `content` reads, `response.messages`, and system messages in `messages` without the flag.
- Its messages are phrased as questions ("on v7 this sums every step; if you meant the last step, read `finalStep`"), with severity `silent` and fix `manual`. Never auto-edit.

**Then, read-only and with no agent spend:** shallow-clone each of the 12 repos, run the scan, and write the results to `data/v7-scan-<date>.csv`. A human must verify each hit by reading the code before anyone calls it a bug.

---

## 6. P2 and after Nov 2

### T15: PR-body "Fixed" matching by rescan

Today a finding counts as fixed if the diff changes a line within ±1 of it (`src/pr-body.ts`). Instead, rescan after the fix stage, and treat a finding as fixed when it's absent from the rescan with the same rule id and file. Keep the proximity rule as a fallback for saved drafts without a rescan.

### T16: Typed-result rule through the type checker

`typed-multi-step-result` matches type annotations syntactically, so `type R = Awaited<ReturnType<typeof generateText>>` and `Pick<GenerateTextResult, …>` aren't resolved. When `node_modules/ai` exists, resolve the declared type with the checker and match on `GenerateTextResult` / `StreamTextResult`. Fall back to syntax otherwise. Fixture: an alias case and a `Pick` case, flagged.

### T17: Hunk-limited eslint fixes

`formatChanged()` skips `eslint --fix` on files that already had lint issues, so the codemod's quote style can leak into diffs. Instead, run eslint `--fix` on a temp copy, then apply only the resulting hunks that overlap lines Shim changed.

### T18: Provider spec v3 → v4 (research first)

Most target repos are AI SDK providers. Venice broke because its provider implements the v3 spec while `@ai-sdk/openai-compatible@3` returns v4 models.
1. **Research doc** `docs/research/provider-spec-v4.md`: `npm pack @ai-sdk/provider@3` and `@4`, diff the `LanguageModelV3` / `V4`, `EmbeddingModel*`, `ImageModel*` and `ProviderV*` types, and list every field change with whether it can be migrated mechanically.
2. **Rule:** find classes and objects implementing those interfaces, and migrate the mechanical changes. If any change isn't mechanical, hold the `@ai-sdk/*` bump back and open an issue with the exact list.

### T19: Evolution run

Follow `docs/roadmap/evolve-runbook.md`. Requires:
- T1, T2, T9 and T10 merged, so the architectures aren't scored against known rule bugs
- H7: a verified API provider and a budget
- a machine that stays up

Score cost per shipped PR, not just shipped count.

### T20: Judge economics

- **Cheaper judge on deps-only diffs:** when a diff touches only package.json and lockfiles, run the judge on Sonnet. Deps-only drafts cost about $0.40 each, nearly all of it judge.
- **Consistency check:** `shim judge-check <n>` reruns the judge on n saved diffs and logs disagreements.
- **Cost per PR:** add cost per shipped PR to `LOG.md` and to the ranking key.

Don't change `JUDGE_RULES` text.

### T22: Sandboxed gates

Run install and gates for target repos in a container with no network after install, a read-only mount of the Shim checkout, and an environment without secrets (T0). The fixer agent's Bash commands should run there too.

### T23: GitHub App prototype

An app that, on install and on each push to the default branch, runs `scan` and opens a Shim PR when the repo is on v6, under the same gates and judge and with the one-PR-per-repo rule. It's for private-repo customers.

---

## 7. Human tasks

| ID | Task | When |
| --- | --- | --- |
| H1 | Open the 12 ready PRs (order and CI notes in `status-and-open-now.md`), log each in `data/prs.csv`, and open the venice issue (T8) | Oct 29–30 |
| H2 | Answer every maintainer comment within hours; run T14 for change requests | Oct 30 – Nov 2 |
| H3 | Choose the npm scope, check the name is free, and run `npm publish` after T7 | Oct 29–30 |
| H4 | Fill `site/lib/site.ts` (waitlist link, GitHub App link, price, founder name) and deploy `site/` to Vercel | Oct 30–31 |
| H5 | Record the 60-second demo: `migrate` on one repo, ending on the judge rejecting a green-but-wrong diff | Oct 31 |
| H6 | Run `shim pr status` (T4) and write the application from its numbers (`yc-big-picture.md`) | Nov 1 |
| H7 | Verify the API provider (token-count and caching probe) or switch to an official Anthropic key before any paid evolution run | Before T19 |
| H8 | Decide whether `drafts/` moves to a private repo | Any time |

---

## 8. Prompt template for handing a task to an agent

Paste this into Claude Code, or another coding agent, in a fresh clone of `https://github.com/JayanthMalladi/shim`. Fill in the task ID.

```text
You are working on Shim (https://github.com/JayanthMalladi/shim). Do task <ID> from
docs/roadmap/agent-action-plan.md on branch roadmap-docs (fetch it: `git fetch origin roadmap-docs`
and read the file with `git show origin/roadmap-docs:docs/roadmap/agent-action-plan.md`).

Before coding: read CLAUDE.md, README.md, section 0 (global rules) and section 1 (repo map) of the
plan, and every file the task names. Follow the task's "Change", "Tests" and "Done when" exactly;
if something in the task turns out to be wrong about the code, stop and report it instead of
guessing.

Work on the branch the task names (create it from origin/main unless it already exists). Make one
commit per logical change; `npm test` and `npm run typecheck` must pass before each commit. Push
the branch. Do not open PRs, issues or comments anywhere unless the task says so. Do not run
`npm publish`. Never use Fable or Mythos models. If the task has an agent-spend cap, stop before
exceeding it and report the actual cost.

Report back briefly: commits, tests added, final test count, anything you didn't do and why.
```
