# Shim

[![npm](https://img.shields.io/npm/v/getshim)](https://www.npmjs.com/package/getshim) [![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Shim is an upgrade agent for TypeScript apps: when an API you depend on changes, it opens one tested pull request that updates your code before it breaks.

```sh
npx getshim scan .
```

Needs Node 22 or later. Site and live PR list: [getshim.vercel.app](https://getshim.vercel.app/)

![Shim scans an AI SDK 7 app, finds result.usage now counts every step, rewrites it to finalStep.usage, and reruns the checks](docs/assets/demo.gif)

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
npx getshim scan path/to/repo
npx getshim migrate path/to/repo --agent --repo owner/name   # --agent needs the claude CLI
```

From a clone: `npm install`, then `npx tsx src/cli.ts scan path/to/repo`.

## Rules (AI SDK 7)

| Rule | Severity | Fix |
|---|---|---|
| `multi-step-result`: `usage`, `toolCalls`, `content`, and similar reads on multi-step results | silent | auto (generateText), agent (streamText, destructuring) |
| `typed-multi-step-result`: the same reads on a parameter, variable, or property declared as `GenerateTextResult`, `StreamTextResult`, or `Awaited<ReturnType<typeof generateText>>`, where the producing call can't be seen | silent | agent |
| `multi-step-end-event`: the same reads on `onFinish`/`onEnd` events | silent | auto / agent |
| `response-messages`: `result.response.messages` now holds only the final step | silent | auto (generateText) / agent |
| `telemetry-needs-otel`: traces stop unless `@ai-sdk/otel` is registered | silent | manual |
| `system-in-messages`: `role: 'system'` in `messages`/`prompt` is rejected at runtime; Shim sets `allowSystemInMessages: true` on the call or `ToolLoopAgent` unless the messages are provably system-free | break | auto (agent when the options are built elsewhere) |
| `esm-only`: `require('ai')` throws | break | agent |
| `node-22`: `engines.node` below 22 | break | manual |
| `ci-node-version`: PR/push-triggered CI runs on Node below 22; rewrites the scalar/inline-matrix `node-version` to 22 (and a same-job matrix list it feeds), and flags a `node-version-file` below 22 | break | auto (node-version) / manual (node-version-file) |
| `total-usage`: `totalUsage` becomes `usage` | deprecated | auto |

## Tracking

`data/prs.csv` records every PR opened: state, merge time, and comments. The merge rate is the number that matters.
