## Upgrade to AI SDK 7

This PR moves the project from AI SDK 6 to 7 and keeps its current behavior, except where noted under "Needs your eyes".

### Versions
- `ai`: ^6.0.149 → ^7.0.0

This drops support for AI SDK 6, so users of this package will need AI SDK 7 too. It probably belongs in a new major version.

### What changed and why
Source files changed (codemod renames and fixer edits): `packages/ai-sdk/src/tools.ts`.

After the codemod, these checks failed; this PR fixes them: `build`, `typecheck .`, `typecheck packages/ai-sdk`.

In AI SDK 7, `tool()` no longer infers the `execute` callback's input type from `inputSchema` in a way that survives this package's `strict` tsconfig — the destructured parameters (`{ content, topic }`, `{ query, goal, since, limit }`) fall back to implicit `any` and fail `noImplicitAny`. The fix types the `execute` callback parameter directly (no public signature change on `createTools`, no new public type import):

```ts
execute: async (args: { content: string; topic?: "work" | "personal" }) => { ... }
execute: async (args: { query: string; goal?: string; since?: string; limit?: number }) => { ... }
```

The `since` field stays `string` to match the `z.iso.datetime().or(z.iso.date())` schema (either form serialises to a string). The `createTools` signature and its returned tool objects are unchanged in shape — only the internal callback typing was added.

### Needs your eyes
Shim did not change these. Please check them before merging.
- `packages/ai-sdk/package.json:1`: AI SDK 7 requires Node.js 22 or later.
- The inline parameter types on the two `execute` callbacks duplicate the schema's field types. If the schema ever changes, update both.

### How it was checked
| Check | Before | After |
|---|---|---|
| install | pass | pass |
| build | pass | pass |
| typecheck . | pass | pass |
| typecheck packages/ai-sdk | pass | pass |

Also ran `npx @ai-sdk/codemod v7` (official). Install ran with `--ignore-scripts`. A second agent reviewed the full diff for behavior changes and unrelated edits.

### Rollback
Revert this PR. No data or config migrations are involved.

---
Opened by [Shim](https://github.com/JayanthMalladi/shim), which turns API breaking changes into tested PRs. Not useful? Close it and we won't open another on this repo.
