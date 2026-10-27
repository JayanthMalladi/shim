# Shim

When an API you depend on changes, Shim opens a tested pull request that updates your code before it breaks.

The first migration is **Vercel AI SDK 6 -> 7**. The official codemod handles renames. Shim handles the changes that still compile but behave differently. For example, on a multi-step call `result.usage` now counts every step, and `result.response.messages` holds only the last step's messages.

## How it works

1. **Baseline.** Install with `--ignore-scripts`, then run the repo's type check and tests. Only gates that pass at baseline count.
2. **Upgrade.** Bump `ai` to ^7 and `@ai-sdk/*` to their latest majors, then run `npx @ai-sdk/codemod v7`.
3. **Find.** Scan the code with ts-morph (`src/rules/ai-sdk-v7.ts`). This finds calls imported from `ai`, follows their result variables and `onFinish`/`onEnd` events, and flags reads whose meaning changed.
4. **Fix.** Deterministic rewrites keep the v6 behavior, for example `result.usage` becomes `result.finalStep.usage`. With `--agent`, the remaining sites go to a headless Claude Code run with a narrow brief.
5. **Check.** Run the gates again. Any regression, or an unresolved breaking finding, produces an issue instead of a PR.
6. **Report.** Write `report.json` and `pr-body.md`.

## Usage

```sh
npm install
npx tsx src/cli.ts scan path/to/repo
npx tsx src/cli.ts migrate path/to/repo --agent --repo owner/name
```

## Rules (AI SDK 7)

| Rule | Severity | Fix |
|---|---|---|
| `multi-step-result`: `usage`, `toolCalls`, `content`, and similar reads on multi-step results | silent | auto (generateText), agent (streamText, destructuring) |
| `multi-step-end-event`: the same reads on `onFinish`/`onEnd` events | silent | auto / agent |
| `response-messages`: `result.response.messages` now holds only the final step | silent | auto (generateText) / agent |
| `telemetry-needs-otel`: traces stop unless `@ai-sdk/otel` is registered | silent | manual |
| `system-in-messages`: `role: 'system'` in messages is rejected at runtime | break | agent |
| `esm-only`: `require('ai')` throws | break | agent |
| `node-22`: `engines.node` below 22 | break | manual |
| `total-usage`: `totalUsage` becomes `usage` | deprecated | auto |

## Tracking

`data/prs.csv` records every PR opened: state, merge time, and comments. The merge rate is the number that matters.
