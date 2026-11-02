## Upgrade to AI SDK 7

This PR moves the project from AI SDK 6 to 7 and keeps its current behavior, except where noted under "Needs your eyes".

### Versions
- `@ai-sdk/anthropic`: ^3.0.0 → ^4.0.0
- `@ai-sdk/openai`: ^3.0.90 → ^4.0.0
- `@ai-sdk/provider`: ^3.0.14 → ^4.0.0
- `@ai-sdk/react`: ^3.0.232 → ^4.0.0
- `ai` (packages/agent-node, devDependencies): ^6.0.238 → ^7.0.0
- `ai` (packages/agent-node, peerDependencies): ^6.0.230 → ^7.0.0
- `ai` (packages/editor, devDependencies): ^6.0.238 → ^7.0.0
- `ai` (packages/editor, peerDependencies): ^6.0.230 → ^7.0.0
- `@ai-sdk/anthropic` (apps/example): ^3.0.104 → ^4.0.0

This drops support for AI SDK 6, so users of this package will need AI SDK 7 too. It probably belongs in a new major version.

### What changed and why
**Fixed: would fail at runtime or type-check on v7**
- `packages/agent-node/src/handler.ts` (`streamText` call): `allowSystemInMessages: true` added — `messages` is built from `convertToModelMessages(conversation)` and may hold a system message, which AI SDK 7 rejects at runtime by default. Keeps the v6 behavior.
- `packages/agent-node/src/handler.ts` (usage ledger): `cachedInputTokens` now reads `total.inputTokenDetails?.cacheReadTokens ?? 0` — v7 removed the top-level `cachedInputTokens` field from `LanguageModelUsage`, so the old expression no longer type-checks. The optional chain preserves the "zeros rather than NaN" invariant for providers whose usage object omits `inputTokenDetails`.
- `packages/agent-node/src/handler.ts` (`sumUsage`): the `cachedInputTokens` line was dropped from the returned object — the field no longer exists on the v7 `LanguageModelUsage` type, so keeping it would fail `tsc` (TS2353).
- `packages/agent-node/src/tools.ts`: an explicit `{}` third generic (the `Context` type parameter) was added to each of the 10 `tool<Input, string>(...)` calls, making them `tool<Input, string, {}>(...)`. In v7 the `Tool` generic signature is `Tool<Input, Output, Context = {}>` where `Context` must be an object type, so the two-arg `tool<Input, string>(...)` form no longer type-checks against the v7 types (TS2344). Passing `{}` explicitly is the minimal fix; the input and output generics are unchanged. `AgentTool` itself is not modified.

Other source files changed (codemod renames and fixer edits): `packages/agent-node/src/handler.ts` (renames: `stepCountIs`→`isStepCount`, `system`→`instructions`, `onStepFinish`→`onStepEnd`, `onFinish`→`onEnd`), `packages/agent-node/src/tools.ts`.

After the codemod, these checks failed; this PR fixes them: `typecheck .`, `test .`, `typecheck packages/agent-node`, `test packages/agent-node`, `typecheck packages/editor`.

### Needs your eyes
Shim did not change these. Please check them before merging.
- `packages/agent-node/package.json:1`, `packages/editor/package.json:1`, `apps/example/package.json:1`: AI SDK 7 requires Node.js 22 or later.

### How it was checked
| Check | Before | After |
|---|---|---|
| install | pass | pass |
| build | fail | fail |
| typecheck . | pass | pass |
| test . | pass | pass |
| typecheck packages/agent-node | pass | pass |
| test packages/agent-node | pass | pass |
| typecheck packages/editor | pass | pass |
| test packages/editor | pass | pass |

Also ran `npx @ai-sdk/codemod v7` (official). Install ran with `--ignore-scripts`. A second agent reviewed the full diff for behavior changes and unrelated edits.

### Rollback
Revert this PR. No data or config migrations are involved.

---
Opened by [Shim](https://github.com/JayanthMalladi/shim), which turns API breaking changes into tested PRs. Not useful? Close it and we won't open another on this repo.
