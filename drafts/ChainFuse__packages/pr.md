## Upgrade to AI SDK 7

This PR moves the project from AI SDK 6 to 7 and keeps its current behavior.

### Versions
- `@ai-sdk/anthropic`: ^3.0.133 → ^4.0.0
- `@ai-sdk/azure`: ^3.0.141 → ^4.0.0
- `@ai-sdk/google`: ^3.0.136 → ^4.0.0
- `@ai-sdk/openai-compatible`: ^2.0.86 → ^3.0.0
- `@ai-sdk/openai`: ^3.0.10 → ^4.0.0
- `@ai-sdk/provider`: ^3.0.19 → ^4.0.0
- `ai`: ^6.0.311 → ^7.0.0

This drops support for AI SDK 6, so users of this package will need AI SDK 7 too. It probably belongs in a new major version.

### What changed and why
**Fixed: would fail at runtime on v7**
- `packages/ai-tools/__tests__/ai-tools.test.mts:187`, `packages/ai-tools/__tests__/ai-tools.test.mts:247`: `messages`/`prompt` has a system message, which AI SDK 7 rejects at runtime by default. `allowSystemInMessages: true` keeps the v6 behavior.
- `packages/ai-tools/__tests__/ai-tools.test.mts:306`, `packages/ai-tools/__tests__/ai-tools.test.mts:376`: This agent may be called with a system message in `messages`/`prompt` (or its calls aren't visible here), which AI SDK 7 rejects by default. Only the constructor accepts the option; `.generate()`/`.stream()` don't. `allowSystemInMessages: true` keeps the v6 behavior.

Other source files changed (codemod renames and fixer edits): `packages/ai-tools/src/providers/types.mts`.

After the codemod, these checks failed; this PR fixes them: `build`, `typecheck packages/ai-tools`.

### How it was checked
| Check | Before | After |
|---|---|---|
| install | pass | pass |
| build | pass | pass |
| typecheck . | fail | fail |
| test . | fail | fail |
| typecheck packages/ai-tools | pass | pass |
| test packages/ai-tools | fail | fail |

Also ran `npx @ai-sdk/codemod v7` (official). Install ran with `--ignore-scripts`. A second agent reviewed the full diff for behavior changes and unrelated edits.

### Rollback
Revert this PR. No data or config migrations are involved.

---
Opened by [Shim](https://github.com/JayanthMalladi/shim), which turns API breaking changes into tested PRs. Not useful? Close it and we won't open another on this repo.
