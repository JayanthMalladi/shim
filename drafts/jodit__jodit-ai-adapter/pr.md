## Upgrade to AI SDK 7

This PR moves the project from AI SDK 6 to 7 and keeps its current behavior, except where noted under "Needs your eyes".

AI SDK 7 changes some values without a type error, so the official codemod alone is not enough here.
For example, `result.usage` on a multi-step call now counts every step instead of only the last one.
Where your code relied on the v6 meaning, this PR reads the same value from `finalStep`.

### Versions
- @ai-sdk/openai: ^3.0.26 -> ^4.0.0
- ai: ^6.0.76 -> ^7.0.0

This drops support for AI SDK 6, so users of this package will need AI SDK 7 too. It probably belongs in a new major version.

### What changed and why
**Fixed: would fail at runtime on v7**
- `src/adapters/base-adapter.ts:135` `messages`/`prompt` is built elsewhere and may hold a system message, which AI SDK 7 rejects at runtime by default. `allowSystemInMessages: true` keeps the v6 behavior.
- `src/adapters/base-adapter.ts:255` `messages`/`prompt` is built elsewhere and may hold a system message, which AI SDK 7 rejects at runtime by default. `allowSystemInMessages: true` keeps the v6 behavior.
- `src/adapters/base-adapter.ts:375` `messages`/`prompt` is built elsewhere and may hold a system message, which AI SDK 7 rejects at runtime by default. `allowSystemInMessages: true` keeps the v6 behavior.

After the codemod, these checks failed; this PR fixes them: `typecheck .`.


### Needs your eyes
Shim did not change these. Please check them before merging.
- `package.json:1` AI SDK 7 requires Node.js 22 or later.

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
