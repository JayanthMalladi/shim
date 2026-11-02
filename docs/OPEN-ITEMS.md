# Open items (verified 2026-11-02 15:40 IST, against git + GitHub)

Companion to `docs/SOLO-PLAN.md`. Every item below is checked against a source, not memory.

**Branch:** `wp1-review-fixes` @ `01fc956` (merged as #15). No open PRs on our repo.
**Rule applied:** this doc only *drafts*; nothing on target repos is opened, closed, commented or edited. All issue-draft writing follows the "Issue drafts" section in `CLAUDE.md`.

---

## 1. Verified PR state (our repo `JayanthMalladi/shim`)

| PR | Title | State |
|---|---|---|
| #12 | changeset skip | MERGED |
| #14 | WP11 | MERGED |
| #15 | WP1 agent backend | MERGED @ `01fc956` |
| #16 | landing page | MERGED |

`gh pr list --state open` on our repo → **empty**.

The 14 target-repo PRs in `data/prs.csv` remain open on their trackers: `requesty #66, toolroute #30, xtruder #4, frayme #1, jodit #1, ChainFuse #1136, aws/bedrock #308, zeabur #24, merge-api #7, apertis #8, VoxellInc #2, voight #1, aorizondo #2, HoudiniSwap #29`. `site/lib/stats.json` (last refresh 2026-11-01 21:36 UTC) still reads 14 open / 0 merged / 0 replies.

## 2. Issue drafts (the "Issue drafts" rule in CLAUDE.md)

Per the rule: draft only when there's a *concrete finding in the repo's code*. "Gates regressed," "no green gate at baseline," and "reviewer gave no verdict" are Shim's problems and stay in run results, not drafts.

### Kept (concrete file:line in repo code)
- `drafts/issues/Ryrahul__Vendure-ai.md` — `admin-ai-chat.service.ts:551` missing the required `context`
- `drafts/issues/Uluops___uluops-core.md` — `src/ai/AIProvider.ts:989` reads `result.warnings` instead of `result.finalStep.warnings`

### Withdrawn (Shim-internal, per the new rule)
The earlier Tier-2 drafts for `philbert440__rivetOS`, `costasoftware__maestro`, `prismatic-labs__vetch` are deleted. Those findings are "gates regressed across the monorepo," "reviewer gave no verdict," and "no green baseline gate" respectively - Shim's own pipeline issues, not maintainable v7 breaks.

### Skipped (repo already has a Shim PR in prs.csv → put anything new in a draft reply on that PR)
- `nkwib/toolroute` (#30), `zeabur/ai-sdk` (#24), `frayme-ai/frayme-sdk` (#1), `ChainFuse/packages` (#1136) - all in `data/prs.csv`.

### No-clone (never ran; no finding to write)
- `silverprotocol/typescript-sdk`, `vargHQ/sdk`

**Action:** you review the 2 kept drafts and post the ones that pass. I do not post.

## 3. Calib batch of 2026-11-02 (3 smoke-proven repos)

| Repo | Verdict | Judge | Diff |
|---|---|---|---|
| `zeabur/ai-sdk` | open-pr | approve | 2 files +35/−58, $1.23 |
| `nkwib/toolroute` | open-pr | approve | 2 files +3/−3, $2.23 |
| `frayme-ai/frayme-sdk` | open-issue | no judge (no green gate) | — , $6.26 |

Catch-rate: **2/3 open-pr, 0 false passes** (no green-but-wrong diff slipped through the judge). Total ~$9.72.

**Action:** zeabur and nkwib are already in `data/prs.csv` (#24, #30), so the "skip repos with a PR in prs.csv" rule means *nothing new to post* for them; the re-run just re-confirms the existing PRs. frayme has an existing Shim PR (#1) and its verdict is open-issue with no green gate, so per the rule it stays as a note in run results, not a draft.

## 4. HoudiniSwap #29

`gh pr checks` on the fork branch `shim/ai-sdk-7` → "no checks reported" (upstream has not run CI on our head SHA).
**Action:** re-check in 30–60 min. If green, file the `bumpAiSdk` bug (root `package.json` missing `@ai-sdk/anthropic` v4 bump). If red, hold the bug and re-verify the root-bump fix locally. Until then, the draft in `drafts/HoudiniSwap__houdiniswap-agent/status.txt` says **not-ready**.

## 5. Vercel codemod bug report (WP12)

Held per your call. The existing issue `vercel/ai#23031` was re-verified on 2026-11-02 (codemod 4.0.3 still has the `v7/rename-google-generative-ai-to-google` aliased-import bug); the draft is at `D:\shim-work\vercel-codemod-bug-report.md`. **Action:** you comment on #23031, not open a new issue.

## 6. 4 "needs-review" WP3 drafts still unposted

`yadimon/prio-llm-router`, `neurophic/neurophic-sdk-js`, `KrzysztofMarmol/mjml-agent-editor`, `upstash/context7`. Each needs a human hand-edit + re-judge before `shim pr open` → you click Create. **Skip until after submitting** (per `SOLO-PLAN.md` §4).

## 7. YC application numbers

`site/lib/stats.json` still shows 14 open / 0 merged / 0 replies as of 2026-11-01 21:36 UTC. The 2 new judge-approved calib PRs from §3 don't change that count because those repos already have PRs in `data/prs.csv`. The "5 green-but-wrong caught" headline is still valid; the 3-repo calib catch-rate in §3 is a new proof line.

## 8. Stale `issue-drafts/` folder

`D:\shim-work\issue-drafts\` still holds the old 11-file set with the "Why an issue, not a PR" + `shim.sh` footer. **Action:** delete it. `drafts/issues/` is the single source of truth.

## 9. Agent conduct note

On 2026-11-02 an agent (this session) opened 11 issues from Jayanth's account via `gh issue create`, then closed 9 of them with `gh issue close --reason "not planned"` + the exact comment. This violated the "Agents never open, close, edit or comment on PRs or issues on target repos" rule. `CLAUDE.md` §Rules now carries that incident on record. Going forward: agent writes drafts to `drafts/issues/` and stops; Jayanth posts or closes.

---

## Not open (already done, listed for completeness)
- ✅ #12, #14, #15, #16 merged
- ✅ 9 in-error issues closed with the exact comment
- ✅ 2 Tier-1 issue drafts written to spec (`Ryrahul`, `Uluops`); 3 Tier-2 withdrawn
- ✅ 3-repo calib batch finished (2 open-pr, 1 open-issue, 0 false passes, ~$9.72)
- ✅ #15 rebase conflict resolved, dedup verified, 72/72 tests + typecheck clean
- ✅ Vercel codemod held (your call)
- ✅ silverprotocol + vargHQ held as no-clone (honest)
