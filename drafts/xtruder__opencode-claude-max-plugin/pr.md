## Upgrade to AI SDK 7

This PR moves the project from AI SDK 6 to 7 and keeps its current behavior.

### Versions
- `@ai-sdk/provider-utils`: 3.0.2 → ^5.0.0
- `@ai-sdk/provider`: 3.0.8 → ^4.0.0
- `ai`: ^6.0.146 → ^7.0.0

This drops support for AI SDK 6, so users of this package will need AI SDK 7 too. It probably belongs in a new major version.

### What changed and why
Source files changed (codemod renames and fixer edits): `examples/standalone-ai-sdk.ts`.

After the codemod, these checks failed; this PR fixes them: `build`, `typecheck .`.

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
