## Upgrade to AI SDK 7

This PR moves the project from AI SDK 6 to 7 and keeps its current behavior.

### Versions
- `ai`: ^6.0.5 → ^7.0.0 (devDependency)

The published `peerDependencies` range (`ai: >=6.0.0`) is unchanged — it already allows AI SDK 7, so consumers on either version can install it. The devDependency bump only affects this repo's own test toolchain.

### What changed and why
**Renamed in AI SDK 7**
- `packages/tools-ai-sdk/src/index.test.ts`: `stepCountIs` is now `isStepCount` (import + 4 call sites). `context7.ts` keeps `stepCountIs` — it is still exported by AI SDK 7 as a v6-compatible alias.

The exported `queryDocs` and `resolveLibraryId` functions are unchanged — no public type was widened.

### Please check before merging
- `packages/tools-ai-sdk/package.json`: AI SDK 7 requires Node.js 22 or later.

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

### Rollback
Revert this PR. No data or config migrations are involved.

---
Opened by [Shim](https://github.com/JayanthMalladi/shim), which turns API breaking changes into tested PRs. Not useful? Close it and we won't open another on this repo.
