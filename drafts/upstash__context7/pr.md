## Upgrade to AI SDK 7

This PR moves the project from AI SDK 6 to 7 and keeps its current behavior.

AI SDK 7 changes some values without a type error, so the official codemod alone is not enough here.
For example, `result.usage` on a multi-step call now counts every step instead of only the last one.
Where your code relied on the v6 meaning, this PR reads the same value from `finalStep`.

### Versions
- ai: ^6.0.5 -> ^7.0.0

This drops support for AI SDK 6, so users of this package will need AI SDK 7 too. It probably belongs in a new major version.

### What changed and why
**Fixed: same code, different behavior on v7**
- `packages/tools-ai-sdk/src/index.test.ts:55` `result.toolCalls` now covers every step, not just the last one. `result.finalStep.toolCalls` keeps the v6 value.
- `packages/tools-ai-sdk/src/index.test.ts:56` `result.toolCalls` now covers every step, not just the last one. `result.finalStep.toolCalls` keeps the v6 value.
- `packages/tools-ai-sdk/src/index.test.ts:57` `result.toolResults` now covers every step, not just the last one. `result.finalStep.toolResults` keeps the v6 value.
- `packages/tools-ai-sdk/src/index.test.ts:58` `result.toolResults` now covers every step, not just the last one. `result.finalStep.toolResults` keeps the v6 value.
- `packages/tools-ai-sdk/src/index.test.ts:74` `result.toolCalls` now covers every step, not just the last one. `result.finalStep.toolCalls` keeps the v6 value.
- `packages/tools-ai-sdk/src/index.test.ts:75` `result.toolCalls` now covers every step, not just the last one. `result.finalStep.toolCalls` keeps the v6 value.
- `packages/tools-ai-sdk/src/index.test.ts:76` `result.toolResults` now covers every step, not just the last one. `result.finalStep.toolResults` keeps the v6 value.
- `packages/tools-ai-sdk/src/index.test.ts:77` `result.toolResults` now covers every step, not just the last one. `result.finalStep.toolResults` keeps the v6 value.

After the codemod, these checks failed; this PR fixes them: `build`.


### How it was checked
| Check | Before | After |
|---|---|---|
| install | pass | pass |
| build | pass | pass |
| typecheck . | pass | pass |
| test . | fail | fail |
| typecheck packages/tools-ai-sdk | pass | pass |
| test packages/tools-ai-sdk | fail | fail |

Also ran `npx @ai-sdk/codemod v7` (official). Install ran with `--ignore-scripts`. A second agent reviewed the full diff for behavior changes and unrelated edits.

### Rollback
Revert this PR. No data or config migrations are involved.

---
Opened by [Shim](https://github.com/JayanthMalladi/shim), which turns API breaking changes into tested PRs. Not useful? Close it and we won't open another on this repo.
