## Upgrade to AI SDK 7

This PR moves the project from AI SDK 6 to 7 and keeps its current behavior, except where noted under "Needs your eyes".

### Versions
- `@ai-sdk/react` (devDependencies): ^3.0.0 → ^4.0.0
- `@ai-sdk/react` (peerDependencies): ^3.0.0 → ^4.0.0
- `ai` (packages/api/package.json, devDependencies): ^6.0.0 → ^7.0.0
- `ai` (packages/api/package.json, peerDependencies): ^6.0.0 → ^7.0.0
- `ai` (packages/runtime/package.json, devDependencies): ^6.0.0 → ^7.0.0
- `ai` (packages/runtime/package.json, peerDependencies): ^6.0.0 → ^7.0.0

This drops support for AI SDK 6, so users of this package will need AI SDK 7 too. It probably belongs in a new major version.

### What changed and why
**Fixed: would fail at runtime on v7**
- `packages/api/test/ai-sdk-tools.test.ts:1037`: `messages`/`prompt` is built elsewhere and may hold a system message, which AI SDK 7 rejects at runtime by default. `allowSystemInMessages: true` keeps the v6 behavior.

Other source files changed (codemod renames and fixer edits): `packages/api/src/ai-sdk/index.ts`.

After the codemod, these checks failed; this PR fixes them: `typecheck packages/api`, `typecheck packages/runtime`.

### Needs your eyes
Shim did not change these. Please check them before merging.
- `packages/api/package.json:1`, `packages/runtime/package.json:1`: AI SDK 7 requires Node.js 22 or later.

### How it was checked
| Check | Before | After |
|---|---|---|
| install | pass | pass |
| build | pass | pass |
| test . | pass | pass |
| typecheck packages/api | pass | pass |
| test packages/api | pass | pass |
| typecheck packages/runtime | pass | pass |
| test packages/runtime | pass | pass |

Also ran `npx @ai-sdk/codemod v7` (official). Install ran with `--ignore-scripts`. A second agent reviewed the full diff for behavior changes and unrelated edits.

### Rollback
Revert this PR. No data or config migrations are involved.

---
Opened by [Shim](https://github.com/JayanthMalladi/shim), which turns API breaking changes into tested PRs. Not useful? Close it and we won't open another on this repo.
