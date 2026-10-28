# Shim: the big picture for YC

As of 2026-10-28. The application is due 2026-11-02. Every number below comes from a file in this repo or a run log, with its source named. Anything not yet known is a bracketed placeholder or is listed under open decisions.

## In one line

**Shim turns API breaking changes into tested pull requests.**

For the 50-character answer: "Tested PRs for API breaking changes" (35 characters).

## The problem

Popular SDKs ship breaking majors several times a year, and every package that depends on them has to upgrade. Today's tools each cover only part of that work:

| Tool | What it does | What it misses |
|---|---|---|
| Dependabot, Renovate | Bump the version number | No code changes at all |
| Official codemods (e.g. `@ai-sdk/codemod`) | Mechanical renames | Changes that still compile but behave differently |
| General coding agents | Edit code on request | No evidence the edit kept behavior. Maintainers can't trust an unreviewed agent PR. |

**The dangerous changes are the silent ones.** AI SDK 7 is the clearest example:
- On a multi-step call, `result.usage` now sums every step instead of returning the last one, so billing and metering code reports different numbers.
- `result.response.messages` now holds only the final step, so stored chat history quietly loses tool calls.
- A `role: 'system'` entry inside `messages` now throws at runtime unless `allowSystemInMessages: true` is set.

None of these produces a type error, and tests that mock a single-step model don't notice them. Our core line: **"Your tests pass. Your behavior changed."**

### Evidence from our own runs

- **Oct 27:** the judge rejected **5 diffs that had passed every typecheck and test**. Without it we'd have opened 5 wrong PRs. Source: overnight report, `evolve/LOG.md`.
- **Oct 28:** the judge caught 2 more (source: `drafts/SUMMARY.csv`):
  - **muxinc/ai:** the official codemod rewrote the project's own `TokenUsage` type in 7 test files.
  - **echoVic/blade-agent-sdk:** the codemod renamed `fullStream`, but the test mocks still returned the old shape.
- **The official codemod renames a repo's own exports.** The `GoogleGenerativeAI` rename touched every identifier containing that name, including Cloudflare's own exports. Shim's codemod guard (`src/codemod-guard.ts`) now catches it.

## What Shim does

| Step | What happens | Why it exists |
|---|---|---|
| 1. Baseline | Install with `--ignore-scripts`, then run the repo's own build, typecheck and tests | Only checks that pass before the upgrade count. We never blame the upgrade for a red that was already there. |
| 2. Upgrade | Bump `ai` and `@ai-sdk/*` in every package.json, then run the official codemod | Reuses Vercel's renames rather than redoing them |
| 3. Find | A ts-morph scanner follows result variables, `onFinish` events and typed results to every read whose meaning changed | This is where the silent changes are caught |
| 4. Fix | Deterministic rewrites first (`result.usage` becomes `result.finalStep.usage`), then a headless agent for the rest | Deterministic fixes are free, repeatable and reviewable. The agent handles the long tail. |
| 5. Check | Every baseline check must still pass | Never ship something that breaks a working check |
| 6. Judge | An independent agent reads the whole diff for behavior changes, casts, weakened tests and unrelated edits | Catches the "green but wrong" diffs above |

The output is a PR with a short body that names every change by file and line, or an **issue** explaining what needs a human.

The PR text only claims what the diff changed. Where Shim can't be sure, it says so under "Needs your eyes".

## Why now

- **AI SDK 7 shipped about six weeks before Oct 27.** On Oct 27 we found **45 npm packages still on `ai@6`**, and **12 of them had migrated on their own** by their GitHub HEAD. Active maintainers move fast; the long tail does not, and people who migrated by hand may have shipped the silent bugs. Source: overnight report, market signal section.
- **Agents can now make real code edits.** What's missing is trust. Shim's product is the evidence around the edit: baseline gates, an independent judge, honest PR text, and an issue instead of a PR when unsure.

## Traction so far

| Number | Value | Source |
|---|---|---|
| PRs opened upstream | 1 ([requestyai/ai-sdk-requesty#66](https://github.com/requestyai/ai-sdk-requesty/pull/66), open) | `data/prs.csv` |
| PR drafts ready to open | 12 (6 with code changes, 6 dependency-only) | `drafts/SUMMARY.csv` |
| Drafts needing a human read first | 4 | `drafts/SUMMARY.csv` |
| Ready rate | 12 of 21 repos attempted on Oct 28 (57%) | `drafts/SUMMARY.csv` |
| Judge catches (passed all gates, rejected anyway) | 5 on Oct 27, 2 on Oct 28 | overnight report, `drafts/SUMMARY.csv` |
| Agent cost per ready PR | $3.82 average; about $0.40 for dependency-only, $0.40 to $5.85 for code | `drafts/SUMMARY.csv` |
| Repos rescued by deterministic fixes on Oct 28 | 2 of the 5 judge rejections from Oct 27 (aorizondo, jodit) plus 1 repo that had become an issue (ChainFuse) are now ready PRs. The fixes themselves cost $0 of agent spend. | `drafts/*/status.txt` |

**What the application needs most:** merged PRs and maintainer replies. Open all 12 drafts by Oct 30 and report the real counts on Nov 1. See `engineering-next-steps.md`.

## The wedge and how it grows

1. **Wedge: AI SDK 6 to 7 for open-source packages.** Every PR doubles as distribution, because it puts Shim in front of a maintainer who owns an AI product.
2. **Silent-bug scan for repos that already migrated.** Run a read-only scan on the 12 self-migrated repos. One real hit ("you upgraded, and your usage numbers are now wrong") is a stronger demo than any bump PR.
3. **More migrations.** Choose them by data: the number of dependents still on the old major, times the number of silent behavior changes in the release. Build a migration spec (rules + fixtures + bump policy) so a new migration means new rules, not a new pipeline.
4. **The API provider pays.** Six of today's 12 ready PRs are AI SDK provider packages: aws, merge, zeabur, apertis, voight and forge. Providers and platforms want their users off old versions, because old versions cost them support time and block deprecations. A provider paying Shim to migrate its ecosystem is a natural business. *Hypothesis, untested.*
5. **Private repos.** A GitHub App that scans on push and opens Shim PRs, paid per org.

## Business model (hypotheses)

| Customer | What they buy | Price |
|---|---|---|
| Open-source maintainers | Nothing. PRs are free, as distribution. | $0 |
| Companies with private repos | GitHub App: scans and PRs for every breaking change across their dependencies | [PRICE] |
| API and SDK providers | A migration campaign for their ecosystem when they ship a major | [PRICE] |

**Cost basis today:** $3.82 of agent spend per ready PR on average, and about $0.40 for dependency-only PRs, where nearly all the cost is the judge. A cheaper judge on diffs with no source changes would cut that further (see `engineering-next-steps.md`).

## Competition

| Who | What they do | How Shim differs |
|---|---|---|
| Dependabot, Renovate | Version bumps, grouped and scheduled | Shim changes the code and proves behavior held |
| Official codemods | One-shot renames per SDK | Shim runs the codemod, then fixes what it misses and catches what it breaks |
| OpenRewrite / Moderne | Recipe-based large-scale refactoring, strongest in Java | Shim targets TypeScript and the AI/SDK ecosystem, and handles changes no recipe expresses, through the agent plus the judge |
| General coding agents (Copilot coding agent, Devin, Claude Code) | Edit code from a prompt | Shim is the opinionated pipeline around the agent: baseline gates, deterministic rules first, an independent judge, and an issue when unsure |

**The biggest competitive risk is Vercel extending its own codemod.** Two answers:
1. Be the layer across all SDKs, not just one.
2. Work with them: the codemod bug Shim found (renaming a repo's own exports) is a good first contact. A draft report existed in the overnight container and needs rewriting.

## Risks and answers

| Risk | Answer |
|---|---|
| Maintainers see bot spam | One PR per repo, never a second after a close, a person reviews each before opening, honest and short PR text, no PRs on archived repos |
| The judge is costly or noisy | Run the judge twice on a sample and log disagreements; use a cheaper judge for dependency-only diffs |
| One migration is too narrow | The migration spec format; the second migration chosen by data |
| Dependence on one model provider | Models are a setting in the fix-stage genome, and the judge stays fixed while a run compares architectures |
| Running untrusted code | `--ignore-scripts` everywhere; next is a sandboxed container with no API keys |
| npm name collision | `shim` on npm is an unrelated package. Publish under a scoped name before the site goes live. |

## Mapping the application

These are the standard YC questions; check them against the current form.

| Question | What to say | Evidence |
|---|---|---|
| What are you making? | Tested PRs for API breaking changes, starting with AI SDK 6 to 7 | The landing page, a sample PR body |
| Why this idea? | Silent breaking changes: tests pass, behavior changes. We saw it in our own runs. | 5 + 2 judge catches; the codemod renaming a repo's own exports |
| What's new about it? | Deterministic behavior-preserving rules, plus an independent judge, plus issue-not-PR when unsure | Pipeline table above |
| How far along? | Working pipeline, 12 ready PRs, first PR open | `drafts/SUMMARY.csv`, `data/prs.csv` |
| Users / traction | PRs opened, merged and replied to, as of Nov 1 | `data/prs.csv` after `shim pr status` |
| Competitors | Dependabot/Renovate, codemods, OpenRewrite, general agents | Competition table |
| How will you make money? | Private-repo app and provider-paid migrations | Business model table (hypotheses) |
| Something surprising | The official codemod itself breaks code, and 12 of 45 maintainers migrated within six weeks, so the gap is the long tail and the silent bugs | Run logs |
| Team | [Founder name], [background], [why you] | n/a |
| Demo | 60 seconds of `migrate` on one repo, ending on the judge rejecting a green-but-wrong diff | Video, to record by Oct 31 |

## The plan

### Through Nov 2

| Date | Work |
|---|---|
| Oct 28–29 | Fix the engine bugs that cost PRs (gitignored files, codemod over-rewrites, a check that was red at baseline hiding new breakage), then rerun HoudiniSwap, ottrix and the 4 needs-review repos |
| Oct 29–30 | Open all 12 PRs; publish the CLI under a scoped npm name and update the site command |
| Oct 30–31 | Deploy the landing page with real links; record the demo |
| Oct 30 – Nov 2 | Answer every maintainer comment within hours |
| Nov 1 | Regenerate the numbers with `shim pr status`; write the application from them |
| Nov 2 | Submit |

### After Nov 2

| Dates | Work |
|---|---|
| Nov 3–5 | Review and merge `evolve-guardrails`; build the 8-repo dev bench and the 5-repo holdout |
| Nov 3–9 | Provider spec v3 to v4 rule (the biggest coverage gap: most targets are providers) |
| Nov 5–10 | Evolution run on an API key, with the guardrails ([evolve-runbook.md](evolve-runbook.md)) |
| Nov 9–15 | GitHub App prototype for private repos |

### Not before Nov 2

None of these change the application's numbers:
- The evolution run
- The GitHub App
- A second migration
- Pricing experiments

## Open decisions

- [ ] npm scope for the CLI, and whether the name is free
- [ ] Who opens PRs: by hand from forks, or Shim pushing to your forks
- [ ] Spend about $15–20 now on reruns (up to 6 more PRs), or hold it for maintainer follow-ups
- [ ] Whether library PRs should also bump the package's own major version
- [ ] Evolution budget and the machine that runs it
- [ ] Whether `drafts/` moves to a private repo (it holds other projects' diffs)
- [ ] Team section: [Founder name], background, why you

## Related docs

- [engineering-next-steps.md](engineering-next-steps.md): code-level next steps, bug backlog, rule gaps
- [evolve-runbook.md](evolve-runbook.md): the prompt for running the architecture evolution on an API key
- Live doc version of the engineering plan: https://claude.ai/artifact/HZMWQJnezMDjsi3eGWuQu9
