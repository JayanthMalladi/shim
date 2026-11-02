## Upgrade to AI SDK 7

This PR moves the project from AI SDK 6 to 7 and keeps its current behavior, except where noted under "Please check before merging".

### Versions
- `ai`: ^6.0.149 → ^7.0.0

This drops support for AI SDK 6, so users of this package will need AI SDK 7 too. It probably belongs in a new major version.

### What changed and why
Source files changed (codemod renames and fixer edits): `packages/ai-sdk/src/tools.ts`.

After the codemod, these checks failed; this PR fixes them: `build`, `typecheck .`, `typecheck packages/ai-sdk`.

In AI SDK 7, `tool()` returns `ExecutableTool<Tool<…>>` whose definition lives in `@ai-sdk/provider-utils` / `@ai-sdk/provider`. This library only depends on `ai`, so tsc can't write the declaration for `createTools`'s return type and fails the build and typechecks with:

```
src/tools.ts(5,17): error TS2742: The inferred type of 'createTools' cannot be named without a reference to
'.pnpm/@ai-sdk+provider-utils@…/node_modules/@ai-sdk/provider-utils'. This is likely not portable.
```

The fix adds one explicit return type to `createTools`, spelling each tool with `Tool<In, Out>` (`Tool` is re-exported by `ai` — no new dependencies). `In` is the schema's field types; `Out` is `{ success: boolean; id: string; status: string }` for `remember` and `{ result: string }` for `recall` (the shape of the `neurophic` client's `RetrieveResponse`). The schemas and the `execute` callbacks are unchanged.

### Please check before merging
- `packages/ai-sdk/package.json:1`: AI SDK 7 requires Node.js 22 or later.
- The `Tool<…>` input types in the new return annotation duplicate the schema's field types. If the schemas ever change, update both.
- The return annotation widens `remember`'s output from `{ success: true, … }` to `{ success: boolean, … }` — callers already treat `success` as boolean; flag it if that's wrong for you.

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
