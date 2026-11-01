# Solo plan: the next 24 hours to YC W27

Written 2026-11-01 17:30 UTC for Jayanth. Shekhar is out and I'm applying solo. This file is my own checklist. `docs/SPEC.md` (another agent is finishing WP7) and `CLAUDE.md` are left as they are. Where they mention Shekhar or say "YC application deferred", this file wins.

**Deadline:** Mon 2026-11-02 8:00 pm PT = **Tue 2026-11-03 9:30 am IST** (04:00 UTC).
**My target:** submit by **Mon 2026-11-02 10:00 pm IST**. That leaves about 11 hours of buffer for a broken form, a reshoot or sleep.

---

## 1. Review of what's been done (as of 2026-11-01)

### Solid, safe to cite
- **The pipeline works end to end and is on `main`**: scan (ts-morph rules for the silent v7 breaks), prepare/finish, gates checked against each repo's own baseline, parallel fixer candidates, a fixed judge, PR tooling (`pr open/record/status`), and the stats site with a 6-hour refresh.
- **The night-one numbers are reproducible from `data/overnight-2026-10-28/scale-results.csv`:** 45 targets, 23 attempted, 11 PR-ready (48%), 5 diffs that passed every gate but were rejected by the judge, 7 issue outcomes, 12 of 45 had already moved to v7 themselves.
- **14 real PRs opened on 2026-10-27..29** (`data/prs.csv`). They include aws/bedrock-agentcore-sdk-typescript#308. 8 are code changes and 6 are deps-only.
- **PR #8 (bot comments no longer count as replies) and PR #9 (spec) are merged.** The live count now reads "0 replied", and that number is honest.
- **Rules held:** no agent touched a target repo, installs use `--ignore-scripts`, and key stripping is intact.

### Risky, check before citing or merging
| Item | Risk | Action |
|---|---|---|
| **HoudiniSwap #29** | Its draft `status.txt` says **not-ready** (build and typecheck fail with TS2742), because the root `package.json` keeps `@ai-sdk/anthropic` on v3. The patch in project files touches only `packages/ai-tools/package.json` and the lockfile. **The open PR may break their build.** | Tonight: open the PR's checks/diff. If the root bump is missing, push it to the fork branch `shim/ai-sdk-7` (root `@ai-sdk/anthropic` to `^4.0.0` and regenerate the lockfile; the fix was verified locally on 2026-10-28) or close the PR. A red PR from Shim is worse than none. |
| **Shim PR #11 (WP1)** | The fix branch `wp1-review-fixes` is a rebase **without** the review fixes. `SHIM_*_MODEL` env vars still bypass the Fable/Mythos ban, the dsh reviewer/judge can still edit the diff they grade, `--budget-usd` is a no-op when unpriced, and the mutator ignores the backend. | **Don't merge before submitting.** The application doesn't need it. |
| **Shim PR #10 (WP11)** | The PR still points at `wp11-path-norm`. The fixes are on `wp11-review-fixes` (CRLF fixture, pure-read scan). | After submitting: retarget or replace it with `wp11-review-fixes`, and confirm `npm test` is green on Windows. |
| **Shim PR #12 (changeset)** | `isPlaceholderName` uses `/fake/i`, so a real package like `@faker-js/faker` or `fakeredis` would lose its changeset. | After submitting: match only `@fake-scope/` and `fake-pkg` exactly, and add a test for a real `faker` name. Low urgency, since no draft is affected today. |
| **Landing page** | `site/lib/site.ts` still has dashed placeholders: `[Join waitlist link]`, `[GitHub App install]` and `[PRICE]`. This PR fills in the founder name. | 20 min tonight: set the waitlist to a real link (e.g. a Tally form or `mailto:`) or remove the button, remove the GitHub App CTA, and set the price or remove it. YC partners click the link. |
| "Merge rate" | 0 merged, 0 human replies. The PRs are 3–5 days old, and first-time-contributor CI is waiting for maintainer approval on some. | Don't call it a merge rate. Say "14 opened, first merges pending" and give the date. |
| The 4 needs-review drafts | Each needs WP3 hand edits plus a re-judge. | **Skip until after submitting.** Opening them half-reviewed the night before risks a bad first impression for one more number. |

### Cofounder dependencies removed
- WP12 (Vercel codemod bug report): I own it now. Send it **after** submitting, once I've re-checked it against the latest `@ai-sdk/codemod`.
- Maintainer outreach, PR tracking, provider conversations: these are mine. The refresh workflow and `pr status` already automate tracking.
- `CLAUDE.md` and `SPEC.md` still name Shekhar. They're left alone on purpose, and this file overrides them.

---

## 2. Numbers for the application (honest, with sources)

Refresh the PR line from `site/lib/stats.json` right before submitting.

| Claim | Value | Source |
|---|---|---|
| Upgrade PRs opened on real repos | 14 (8 code, 6 deps-only), incl. AWS | `data/prs.csv` |
| Merged / human replies | 0 / 0 as of 2026-11-01 12:32 UTC | `site/lib/stats.json` |
| PR-ready rate, one unattended night | 11 of 23 attempted (48%) | `scale-results.csv` |
| Diffs that passed tests + tsc and were still wrong (caught by judge) | 5 | `scale-results.csv` (`judge-rejected`) |
| Agent cost, all-in | $50.88 for 23 attempts, so **$4.63 per PR-ready repo**. The median PR-ready run was $0.19, and the max was $4.93. | `scale-results.csv` |
| Market signal | 12 of 45 ai@6 packages self-migrated within ~6 weeks | `scale-results.csv` (skips) |
| Build time | Zero to 14 external PRs in 3 days (Oct 27–29), solo | git log |

If WP7 (audit mode) lands with real findings before I submit, add one line: "Audit mode found N silent v7 bugs in M repos that migrated themselves." Only add it if the drafts exist.

---

## 3. Solo-founder framing

**What YC will wonder:** can one person build *and* sell, and will they stay full-time? (I'm a final-year student with a Goldman Sachs full-time offer.)

**How to answer:**
1. **Say it plainly, once.** "I'm a solo founder. A friend helped early with GTM thinking but is starting an MBA and isn't going full-time." Keep it neutral and don't over-explain. Don't list Shekhar anywhere, and use "I" throughout, not "we".
2. **Show velocity as the proof.** I built Shim alone from zero to 14 real PRs in 3 days, including the judge that caught 5 wrong-but-green diffs. At Goldman I solo-built an LLM prompt platform in 8 weeks (versioned prompts, validation gates), demoed it to ~20 VPs and 3 MDs, and got a full-time offer. Same pattern both times: LLM pipelines with hard validation gates.
3. **Why solo fits this product.** The product is its own distribution. Every PR is a sales touch delivered to a maintainer, and agents do the per-repo labor. The work that doesn't scale (reviewing diffs, answering maintainers) is technical. The first hire is a second technical founder or a founding engineer who has been a maintainer of an OSS dev tool.
4. **Commitment.** I'll decline the GS offer if accepted, and I'll do the batch full-time (say how college fits: final semester remote/deferred, whatever is true). Say this in the "commitment" or "anything else" field.
5. **Open to a cofounder.** If the form asks, answer "yes, open to a technical cofounder; using YC co-founder matching". Being open is fine. Don't promise someone by name.

---

## 4. Checklist, ordered by deadline

Times are IST (I'm in India). PT is in brackets.

### Tonight, Sun Nov 1, before sleep (~1.5 h) [Sun ~10:30 am to 12 pm PT]
- [ ] **Check all 14 PRs on GitHub** for maintainer comments, review requests or "approve workflow" notices. Answer any human comment within the hour. Paste it to an agent for a draft reply and fix, and push fixes to `shim/ai-sdk-7`.
- [ ] **HoudiniSwap #29**: verify the build is green. Fix it or close it (see the table above).
- [ ] **ChainFuse #1136, requesty #66**: confirm the comments are still bots only. If CI is waiting for approval, a one-line comment is fine: "CI is waiting on workflow approval for a first-time contributor; happy to fix anything it finds."
- [ ] **Merge this PR** (it fills in the founder name in the site footer). Then fix the waitlist, GitHub App and price placeholders, or remove them.
- [ ] **Freeze `main`**: don't merge #10, #11 or #12 until after submitting.

### Mon Nov 2 morning (~3 h) [Sun 8:30 pm to 11:30 pm PT]
- [ ] Write the application text using the drafts in section 5. Read every number against section 2.
- [ ] Re-check the PR counts: `site/lib/stats.json` after the 6-hour refresh, or `GITHUB_TOKEN=... npx tsx src/cli.ts pr status` locally.
- [ ] Have a friend or an agent read the application cold. Can they say what Shim does in one sentence?

### Mon Nov 2 afternoon (~2 h) [Mon ~1:30 am to 3:30 am PT]
- [ ] **Founder video (1 min, solo).** Reshoot any version recorded with Shekhar. Script: who I am (10 s), the silent break with one concrete example where `result.usage` doubles on multi-step calls and tests stay green (20 s), what Shim does and the traction so far (20 s), why me and why solo (10 s).
- [ ] **Optional product demo (≤2 min)**: screen-record `scan` on a fixture showing a silent finding, then a real open PR diff, then the judge rejecting a green-but-wrong diff.

### Mon Nov 2 evening (~1 h) [Mon ~6:30 am to 9:30 am PT]
- [ ] Final number refresh, paste everything, upload the videos, add the site link and the GitHub repo link (the repo is public; make sure no secrets are in history, which `src/exec.ts` and the rules already guard).
- [ ] **Submit by 10:00 pm IST** (9:30 am PT Mon). The hard stop is Tue 9:30 am IST.

### After submitting (Tue onward)
- [ ] Keep answering maintainers. Send YC an update if a PR merges before interviews.
- [ ] Fix PR #12's regex. Replace #10 with `wp11-review-fixes`. Get the WP1 review findings fixed before #11 merges.
- [ ] WP3: finish the 4 needs-review drafts, then open them.
- [ ] Send the Vercel codemod report (WP12), re-checked first.

---

## 5. Draft application answers (edit to my voice)

**Company, 50 chars:** Shim: tested PRs for API breaking changes

**What are you making?** When an API you depend on ships a breaking change, Shim opens a tested pull request that migrates your code before it breaks. I started with the Vercel AI SDK 6 to 7. Most of its breaks are silent: tests and `tsc` still pass, but on multi-step calls `usage`, `toolCalls` and `text` now cover every step, so billing and logs quietly double-count. The official codemod handles renames. Shim handles the behavior changes, proves it kept the repo's own tests green, and runs an independent judge that rejects diffs that pass the checks but are wrong.

**Progress:** I built it solo starting Oct 27. In 3 days it opened 14 upgrade PRs on real open-source repos, including AWS's bedrock-agentcore SDK. In one unattended night it attempted 23 repos, got 11 to PR-ready (48%), and its judge caught 5 diffs that passed every test and type check but changed behavior. Agent cost is $4.63 per PR-ready repo, all-in. No merges yet; the PRs are under a week old. [Update the count before submitting.]

**Why now / insight:** 12 of the 45 ai@6 packages I scanned migrated themselves within ~6 weeks. Active maintainers move fast, and the long tail doesn't, so it breaks silently. AI SDKs, model APIs and agent frameworks now ship majors every few months, and every one of those is a migration for every customer.

**Business model:** Free on public repos (this builds the merge-rate proof). Paid per org for private repos. Later, API providers pay to push their own migrations into customers' code: one migration, delivered as PRs to everyone who depends on them.

**Competitors:** official codemods (renames only), Renovate/Dependabot (version bumps only, no code), general coding agents (wait to be asked, with no change list, no baseline proof and no judge).

**Why you / solo:** see section 3, points 2 to 4.

---

*Source files: `data/prs.csv`, `site/lib/stats.json`, `data/overnight-2026-10-28/scale-results.csv`, `drafts/READY.md`, `drafts/HoudiniSwap__houdiniswap-agent/status.txt`, Shim PRs #8 to #12, `/mnt/project-files/shim/reviews/2026-10-31-pr10-pr11.md`.*
