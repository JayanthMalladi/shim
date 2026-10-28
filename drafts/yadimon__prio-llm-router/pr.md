## Upgrade to AI SDK 7

This PR moves the project from AI SDK 6 to 7 and keeps its current behavior, except where noted under "Needs your eyes".

AI SDK 7 changes some values without a type error, so the official codemod alone is not enough here.
For example, `result.usage` on a multi-step call now counts every step instead of only the last one.
Where your code relied on the v6 meaning, this PR reads the same value from `finalStep`.

### Versions
- @ai-sdk/anthropic: ^3.0.64 -> ^4.0.0
- @ai-sdk/cohere: ^3.0.27 -> ^4.0.0
- @ai-sdk/deepseek: ^2.0.26 -> ^3.0.0
- @ai-sdk/google: ^3.0.54 -> ^4.0.0
- @ai-sdk/groq: ^3.0.31 -> ^4.0.0
- @ai-sdk/mistral: ^3.0.27 -> ^4.0.0
- @ai-sdk/openai: ^3.0.48 -> ^4.0.0
- @ai-sdk/openai-compatible: ^2.0.37 -> ^3.0.0
- @ai-sdk/perplexity: ^3.0.26 -> ^5.0.0
- @ai-sdk/togetherai: ^2.0.41 -> ^3.0.0
- @ai-sdk/xai: ^3.0.74 -> ^5.0.0
- ai: ^6.0.141 -> ^7.0.0

This drops support for AI SDK 6, so users of this package will need AI SDK 7 too. It probably belongs in a new major version.

### What changed and why
**Fixed: same code, different behavior on v7**
- `src/provider-factory.ts:64` This call's options are built elsewhere. If `messages`/`prompt` can hold a system message, AI SDK 7 rejects it at runtime: set `allowSystemInMessages: true` in the options (keeps the v6 behavior), or move it to `instructions`.
- `src/provider-factory.ts:72` This call's options are built elsewhere; if they set stopWhen, `result.usage` now covers every step, not just the last one. `result.finalStep.usage` keeps the v6 value.
- `src/provider-factory.ts:77` This call's options are built elsewhere; if they set stopWhen, `result.warnings` now covers every step, not just the last one. `result.finalStep.warnings` keeps the v6 value.
- `src/provider-factory.ts:100` This call's options are built elsewhere. If `messages`/`prompt` can hold a system message, AI SDK 7 rejects it at runtime: set `allowSystemInMessages: true` in the options (keeps the v6 behavior), or move it to `instructions`.
- `src/provider-factory.ts:108` This call's options are built elsewhere; if they set stopWhen, `result.warnings` now covers every step, not just the last one. `result.finalStep.warnings` keeps the v6 value.

**Fixed: deprecated in v7**
- `src/provider-factory.ts:105` `totalUsage` is deprecated; `usage` now covers all steps.

After the codemod, these checks failed; this PR fixes them: `typecheck .`, `test .`.


### Needs your eyes
Shim did not change these. Please check them before merging.
- `package.json:1` AI SDK 7 requires Node.js 22 or later.

### How it was checked
| Check | Before | After |
|---|---|---|
| install | pass | pass |
| build | pass | pass |
| typecheck . | pass | pass |
| test . | pass | pass |

Also ran `npx @ai-sdk/codemod v7` (official). Install ran with `--ignore-scripts`. A second agent reviewed the full diff for behavior changes and unrelated edits.

### Rollback
Revert this PR. No data or config migrations are involved.

---
Opened by [Shim](https://github.com/JayanthMalladi/shim), which turns API breaking changes into tested PRs. Not useful? Close it and we won't open another on this repo.
