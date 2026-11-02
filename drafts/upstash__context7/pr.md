## Upgrade to AI SDK 7

This PR moves the project from AI SDK 6 to 7 and keeps its current behavior.
On a multi-step call, `result.usage` now counts every step instead of only the last one. Where your code relied on the v6 meaning, this PR reads the same value from `finalStep`.

### Versions
- `ai`: ^6.0.5 → ^7.0.0 (devDependency)

The published `peerDependencies` range (`ai: >=6.0.0`) is unchanged — it already allows AI SDK 7, so consumers on either version can install it.
This drops support for AI SDK 6 in the dev/test toolchain, so users of this package will need AI SDK 7 too. It probably belongs in a new major version.

### What changed and why
**Fixed: same code, different behavior on v7**
- `packages/tools-ai-sdk/src/index.test.ts:55`, `packages/tools-ai-sdk/src/index.test.ts:56`, `packages/tools-ai-sdk/src/index.test.ts:74`, `packages/tools-ai-sdk/src/index.test.ts:75`: `result.toolCalls` now covers every step, not just the last one. `result.finalStep.toolCalls` keeps the v6 value.
- `packages/tools-ai-sdk/src/index.test.ts:57`, `packages/tools-ai-sdk/src/index.test.ts:58`, `packages/tools-ai-sdk/src/index.test.ts:76`, `packages/tools-ai-sdk/src/index.test.ts:77`: `result.toolResults` now covers every step, not just the last one. `result.finalStep.toolResults` keeps the v6 value.

**Renamed in AI SDK 7**
- `packages/tools-ai-sdk/src/agents/context7.ts:1`, `packages/tools-ai-sdk/src/agents/context7.ts:42`: `stepCountIs` is now `isStepCount`.
- `packages/tools-ai-sdk/src/index.test.ts:2`, `packages/tools-ai-sdk/src/index.test.ts:51`, `packages/tools-ai-sdk/src/index.test.ts:70`, `packages/tools-ai-sdk/src/index.test.ts:89`, `packages/tools-ai-sdk/src/index.test.ts:128`: same rename.

The exported `queryDocs` and `resolveLibraryId` functions are unchanged — no public type was widened.

After the codemod, these checks failed; this PR fixes them: `build`.

### Needs your eyes
Shim did not change these. Please check them before merging.
- `packages/tools-ai-sdk/package.json:1`: AI SDK 7 requires Node.js 22 or later.
- `packages/tools-ai-sdk/src/index.test.ts`: the test reads now use `result.finalStep.*`. These tests call the real OpenRouter API and are skipped without `OPENROUTER_API_KEY`, so they were failing before this PR too — they are unchanged in behaviour, only in where the value is read from.

### How it was checked
| Check | Before | After |
|---|---|---|
| install | pass | pass |
| build | pass | pass |
| typecheck . | pass | pass |
| test . | fail | fail |
| typecheck packages/tools-ai-sdk | pass | pass |
| test packages/tools-ai-sdk | fail | fail |

The two test gates fail both before and after this PR, for the same reason: they call the real OpenRouter API and need `OPENROUTER_API_KEY`. No gate that passed before fails now.

Also ran `npx @ai-sdk/codemod v7` (official). Install ran with `--ignore-scripts`. A second agent reviewed the full diff for behavior changes and unrelated edits.

### Rollback
Revert this PR. No data or config migrations are involved.

---
Opened by [Shim](https://github.com/JayanthMalladi/shim), which turns API breaking changes into tested PRs. Not useful? Close it and we won't open another on this repo.
