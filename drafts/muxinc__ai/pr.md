## Upgrade to AI SDK 7

This PR moves the project from AI SDK 6 to 7 and keeps its current behavior, except where noted under "Needs your eyes".

AI SDK 7 changes some values without a type error, so the official codemod alone is not enough here.
For example, `result.usage` on a multi-step call now counts every step instead of only the last one.
Where your code relied on the v6 meaning, this PR reads the same value from `finalStep`.

### Versions
- @ai-sdk/anthropic: ^3.0.16 -> ^4.0.0
- @ai-sdk/google: ^3.0.10 -> ^4.0.0
- @ai-sdk/openai: ^3.0.124 -> ^4.0.0
- @ai-sdk/openai-compatible: ^2.0.51 -> ^3.0.0
- ai: ^6.0.42 -> ^7.0.0

This drops support for AI SDK 6, so users of this package will need AI SDK 7 too. It probably belongs in a new major version.

### What changed and why
**Fixed: would fail at runtime on v7**
- `scripts/post-evalite-results.ts:1014` `messages`/`prompt` has a system message, which AI SDK 7 rejects at runtime by default. `allowSystemInMessages: true` keeps the v6 behavior.
- `scripts/verify-vision-models.ts:80` `messages`/`prompt` has a system message, which AI SDK 7 rejects at runtime by default. `allowSystemInMessages: true` keeps the v6 behavior.
- `src/workflows/generate-text.ts:829` `messages`/`prompt` is built elsewhere and may hold a system message, which AI SDK 7 rejects at runtime by default. `allowSystemInMessages: true` keeps the v6 behavior.

After the codemod, these checks failed; this PR fixes them: `build`, `typecheck .`.


### Needs your eyes
Shim did not change these. Please check them before merging.
- `package.json:1` AI SDK 7 requires Node.js 22 or later.
- `src/workflows/ask-questions.ts:727` OpenTelemetry moved to @ai-sdk/otel. Without `registerTelemetry(new OpenTelemetry())` at startup, traces stop being emitted with no error. Install @ai-sdk/otel and register it once.

### How it was checked
| Check | Before | After |
|---|---|---|
| install | pass | pass |
| build | pass | pass |
| typecheck . | pass | pass |
| test . | fail | fail |

Also ran `npx @ai-sdk/codemod v7` (official). Install ran with `--ignore-scripts`. A second agent reviewed the full diff for behavior changes and unrelated edits.

### Rollback
Revert this PR. No data or config migrations are involved.

---
Opened by [Shim](https://github.com/JayanthMalladi/shim), which turns API breaking changes into tested PRs. Not useful? Close it and we won't open another on this repo.
