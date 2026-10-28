# Shim engineering next steps

As of 2026-10-28. This is the repo copy of the [live doc](https://claude.ai/artifact/HZMWQJnezMDjsi3eGWuQu9). For the strategy behind it, see [yc-big-picture.md](yc-big-picture.md).

## Where things stand

12 PR drafts are ready to open, 4 need a human read first, and 5 failed for reasons the next code batch can mostly fix. The engine fixes behind them are on `main` (363d9a1, 45 tests). About $45 of the $91 agent budget is left.

| Area | State | Where |
| --- | --- | --- |
| Engine (scanner, rules, gates, fixer, judge) | Fixes A to J merged, 45 tests passing | `main` |
| Landing page (direction B, Transcript) | Built as a static export, not deployed; 4 placeholders unfilled | `main`, `site/` |
| PR drafts (21 repos) | 12 ready, 4 needs-review, 5 not-ready | `claude/serene-babbage-yzfhbn`, `drafts/` |
| Evolution guardrails (budget stop, model allowlist, genome bounds, durable results) | Written, not reviewed or merged | `evolve-guardrails` |
| Evolution runbook | Written | [evolve-runbook.md](evolve-runbook.md) |
| Open upstream PRs | 1: requestyai/ai-sdk-requesty#66 | GitHub |

Agent spend on Oct 28 was $45.86 across two draft batches (21 repos). Deps-only drafts cost about $0.40 each, because the judge runs on every PR. Code drafts cost $0.40 to $5.85.

## Before Nov 2: ship the 12 PRs

Open all 12 by Oct 30 so maintainers have at least three days to respond before the application. Merge count and reply rate are the numbers YC will weigh. No code change moves them as much as time with maintainers.

1. **Refresh each draft against the repo's current HEAD before opening.** Drafts were cut on Oct 28. `git apply --3way` handles small drift; a conflict means regenerate (about $0.40 deps-only, $2 to $6 code).
2. **Open the 6 code PRs first** (toolroute, xtruder, frayme, aorizondo, jodit, ChainFuse), then the 6 deps-only ones. Code PRs show the product; deps-only PRs are the easiest merges.
3. **One PR per repo,** from a fork branch `shim/ai-sdk-7`, with the draft's `pr.md` verbatim as the body. Read the "Needs your eyes" line before clicking Create.
4. **Log every PR** in `data/prs.csv` the moment it opens: repo, PR URL, opened date, kind.
5. **Check PRs twice a day,** and answer every maintainer comment within hours.

Code needed for this phase:

- [ ] `shim pr open <draft-dir> --fork <owner>/<repo>`: apply the patch on a fresh clone, push the branch, print the compare URL. Cuts manual work per PR from about 10 minutes to 1.
- [ ] `shim pr status`: read `data/prs.csv`, query GitHub for state, merged-at, review state and comment count, and write it back. This is where the merge-rate number comes from.
- [ ] `shim pr followup <pr-url>`: fetch review comments, run the fixer on the requested change with the same gates and judge, and push to the PR branch. Reserve about $20 of budget for this.

## Engine bug backlog

Six bugs surfaced in Oct 28's runs, and the first three each cost a real PR. All are fixable with deterministic code plus a fixture, with no agent spend until the rerun.

| # | Bug | Seen in | Fix | Cost of leaving it |
| --- | --- | --- | --- | --- |
| 1 | The scanner reads gitignored build outputs, so findings land in files that aren't committed | ChainFuse (`*.test.mjs`) | When the root is a git repo, load only `git ls-files` plus untracked files that aren't ignored | Bogus "Needs your eyes" items in PR bodies |
| 2 | The official codemod rewrites the repo's own types and names (`TokenUsage` fields, `system` keys in raw HTTP bodies, `fullStream` in mocks), and gates don't see it | muxinc/ai, echoVic, ottrix | A new guard beside `codemod-guard.ts`: check each codemod edit against AI SDK symbols resolved by ts-morph; revert edits on non-SDK symbols and report them | 2 PRs lost, and worse if a judge misses one |
| 3 | A check already red at baseline hides new breakage (`test .` in echoVic) | echoVic | Record per-test results at baseline (vitest/jest JSON reporters) and fail on any test that passed before | Wrong PRs can pass gates |
| 4 | PR-body "Fixed" matching uses line proximity, so a fix far from its finding is listed under "Needs your eyes" | yadimon | Record the fixer's edits per finding, or rescan after fixing and diff the finding sets | Under-claims, never over-claims; low priority |
| 5 | `typed-multi-step-result` doesn't resolve type aliases and wrappers (`type R = Awaited<…>`, `Pick<GenerateTextResult, …>`) | none yet | Resolve the declared type through the type checker instead of matching syntax | Missed silent bugs |
| 6 | `eslint --fix` skips any file with pre-existing lint issues, so the codemod's quote style can leak into diffs | jodit-style repos | Run eslint fixes limited to changed line ranges (a post-filter on hunks) | Noisy diffs |

Each fix lands with a fixture case in `test/fixtures/v6-app` (or a temp repo for 1 and 3), a must-not-flag case, and an assertion, per `CLAUDE.md`.

## Rule coverage gaps

The biggest gap is provider packages. Most of the target list are AI SDK providers, and none of today's rules migrate the provider spec. Ranked by how many targets each gap blocks:

1. **Provider spec v3 → v4.** Repos that implement `ProviderV3` / `LanguageModelV3` break when `@ai-sdk/provider` and `@ai-sdk/openai-compatible` move to their v7-era majors (venice: TS2352 at `src/venice-provider.ts:113`). Build a rule that finds spec implementations, then either migrates the known field changes deterministically or holds the `@ai-sdk/*` bump back with a clear issue. Needs a written diff of the v3 and v4 spec types first.
2. **CI on Node < 22.** Nearly every PR carries "AI SDK 7 requires Node.js 22". If a repo's GitHub Actions matrix tests Node 18 or 20, the PR goes red upstream on day one. Detect `node-version` in `.github/workflows/*.yml` and flag it in the PR body; propose the matrix change as a separate, optional commit.
3. **pnpm `catalog:`.** It blocked 3 repos at triage. Read the catalogs in `pnpm-workspace.yaml`, bump there, and leave the `catalog:` references untouched.
4. **Required `context` in tool execution options.** ottrix's typecheck failed on a `ToolExecutionOptions` literal in a test. Add a rule that flags literals missing the field; the new fixer rule allows the type-only test edit.
5. **Telemetry.** `telemetry-needs-otel` is manual today. Leave it manual, but make the PR body say exactly which file to register `@ai-sdk/otel` in.

Each new rule needs the fixture case, a must-not-flag case, and a README rules-table row.

## Architecture and evolution

Run the evolution after Nov 2, on a paid API key, once the guardrails branch is reviewed. Oct 28's evidence says deterministic fixes beat architecture changes on cost: fixes A to J turned 2 of the 5 judge rejections, plus 1 earlier issue, into ready PRs, and the fixes themselves cost $0 of agent spend.

1. **Review and merge `evolve-guardrails`.** The budget stop, model allowlist, genome bounds and durable results are written but have only been tested by their author. Run `npm test`, read the diff, and test the budget stop with a fake archive before trusting it with money.
2. **Fix the bug backlog first** (section above). Evolving on top of known rule bugs rewards architectures that work around them, and those gains vanish once the rules are fixed.
3. **Build the bench** (8 dev repos, 5 holdout) with `prepare`. No agent spend.
4. **Score the 4 seeds** on the dev set. Expect about $150 to $200. Stop after v1 to check real costs.
5. **Mutate** within the remaining budget; about $40 per child.
6. **Confirm on the holdout** before changing `DEFAULT_ARCH`. A win smaller than one repo on the combined set is a tie; keep the cheaper genome.

Three code changes make the evolution worth more per dollar:

- [ ] **Cost per shipped PR** as a first-class metric in `LOG.md` and in the ranking, next to shipped count.
- [ ] **Judge consistency check:** run the judge twice on a sample of diffs and log disagreements. A noisy judge makes every score noise.
- [ ] **Cheaper judge on easy diffs:** deps-only diffs (no source changes) could skip the judge or use Sonnet. Today they cost about $0.40 each, almost all of it judge.

## Product surface

The landing page needs only the four placeholders and a deploy. The CLI's install path is a must-fix: the npm name `shim` belongs to an unrelated polyfill package (v0.6.0) and our package.json is private, so the site's `npx shim scan .` would run someone else's code.

| Piece | Next step | Before Nov 2? |
| --- | --- | --- |
| Landing page | Fill `site/lib/site.ts` (waitlist link, GitHub App link, price, founder name), deploy to Vercel with root `site`, and set `NEXT_TELEMETRY_DISABLED=1` | Yes |
| Waitlist | A form that writes somewhere you own (a Google Form or Tally is fine for now) | Yes |
| npm package | Publish under a scoped name you control (for example `@<your-scope>/shim`) with `scan` working offline and `migrate` requiring an API key. Then change every `npx shim` on the site and in PR bodies. Until then, take the command off the site. | Yes, must-fix before the site goes live |
| `scan` for v7 repos | A read-only mode for repos already on v7 that flags reads whose meaning changed (`usage` on multi-step results). Run it on the 12 self-migrated repos. | Optional; the strongest demo if it finds a real bug |
| GitHub App | Install on a repo, run `scan` on push, and open a Shim PR when the repo is on v6 | After |
| Demo video | 60 seconds of `migrate` on one repo, ending on a judge rejection of a green-but-wrong diff | Yes |

## Measurement

The application should lead with merge rate and the judge stat, both read from files in the repo, not from memory. Build `shim pr status` (section 2) so the numbers regenerate with one command on Nov 1.

| Number | Definition | Source | As of Oct 28 |
| --- | --- | --- | --- |
| PRs opened | Shim PRs opened upstream | `data/prs.csv` | 1 |
| PRs merged | Opened PRs merged by a maintainer | `data/prs.csv` via GitHub API | 0 |
| Merge rate | Merged ÷ opened, counting only PRs open ≥ 3 days | derived | n/a |
| Maintainer reply rate | PRs with any maintainer comment or review ÷ opened | GitHub API | n/a |
| PR-ready rate | Ready drafts ÷ repos attempted | `drafts/SUMMARY.csv` | 12 of 21 (57%) |
| Judge catches | Diffs that passed every gate but the judge rejected | evolution log + drafts | 5 on Oct 27; 2 on Oct 28 (muxinc, echoVic) |
| Agent cost per ready PR | Agent spend ÷ ready drafts | `drafts/SUMMARY.csv` | $45.86 ÷ 12 = $3.82 |

Two cautions for the write-up:
- Count a PR as merged only once it is merged, not when it's approved.
- Keep deps-only and code PRs separate, since a merged deps-only PR shows less of what Shim does.

## Safety and trust

Shim runs strangers' code and opens PRs in strangers' repos, so the rules that keep both safe should be enforced in code, not just in prompts.

- **Untrusted installs.** Every install uses `--ignore-scripts`, and pnpm's verify-deps-before-run is off for every check. Next: run target installs and gates in a container with no network after install and no access to API keys. Today the fixer agent and the target's test scripts share one environment with `ANTHROPIC_API_KEY` in it.
- **Secrets in drafts.** `changes.patch` and `report.json` are committed to the Shim repo, which is public. Add a secret scan on drafts before commit (gitleaks or a regex pass) so a target's `.env` sample or token in a diff never lands in our repo.
- **PR etiquette.** One PR per repo, never a second after a close (the footer promises this), never on archived repos, and skip repos whose CONTRIBUTING asks for an issue first. Encode the "never again" promise as a check against `data/prs.csv` in `shim pr open`.
- **Honest PR text.** The PR body only claims what the diff changed (fix H). Keep the judge's rule against casts, `@ts-ignore`, widening public types, and weakening tests.
- **Rate of PRs.** Opening 12 PRs from a new account in two days can trip GitHub's spam heuristics. Space them out, and review each one before opening.

## Sequencing

Everything that changes the application's numbers lands by Nov 2. The evolution run and the bigger rules come after. The live doc draws this as a timeline.

| Dates | Workstream |
| --- | --- |
| Oct 28–29 | Engine bugs 1–3 and reruns |
| Oct 29–30 | Publish to npm under a scope, fix the site command |
| Oct 29–30 | Open the 12 PRs |
| Oct 30–31 | Deploy the landing page |
| Oct 31 | Demo video |
| Oct 30 – Nov 2 | Maintainer follow-ups |
| Nov 1 | Numbers for the application (`shim pr status`) |
| **Nov 2** | **YC application due** |
| Nov 3–5 | Guardrails review and bench |
| Nov 3–9 | Provider spec v4 rule |
| Nov 5–10 | Evolution run |
| Nov 9–15 | GitHub App |

The PRs open by Oct 30 so maintainers get three days. Publishing to npm comes before the site goes live, because the site's command must point at our package. After Nov 2, the guardrails review gates any API-key spend.

## Open questions

- [ ] Which npm scope will Shim publish under, and is the name free?
- [ ] Who opens the PRs: you by hand from forks, or Shim pushing to your forks (which needs access approval per fork)?
- [ ] Rerun HoudiniSwap, ottrix and the 4 needs-review repos now (about $15 to $20), or hold that budget for maintainer follow-ups?
- [ ] For library repos, should Shim's PR also bump the package's own major version, or only say it "probably belongs in a new major" as today?
- [ ] What's the evolution budget on the API key, and which machine runs it?
- [ ] Should `drafts/` live in a private repo instead of the public Shim repo?
