## Upgrade to AI SDK 7

This PR moves the project from AI SDK 6 to 7 and keeps its current behavior, except where noted under "Please check before merging".

### Versions
- `ai`: ^6.0.149 → ^7.0.0

This drops support for AI SDK 6, so users of this package will need AI SDK 7 too. It probably belongs in a new major version.

### What changed and why
Source files changed (codemod renames and fixer edits): `packages/ai-sdk/src/tools.ts`.

After the codemod, these checks failed; this PR fixes them: `build`, `typecheck .`, `typecheck packages/ai-sdk`.

In AI SDK 7, `tool()` returns `ExecutableTool<Tool<…>>` whose declaration lives in `@ai-sdk/provider-utils` / `@ai-sdk/provider`, neither of which this library depends on (only on `ai`). So tsc can't write the declaration file for `createTools`'s inferred return type and fails the build and typechecks with:

```
src/tools.ts(5,17): error TS2742: The inferred type of 'createTools' cannot be named without a reference to
'.pnpm/@ai-sdk+provider-utils@…/node_modules/@ai-sdk/provider-utils'. This is likely not portable.
```

The fix adds one explicit return type to `createTools`, spelling each tool as `Tool<In, Out>` (`Tool` is re-exported by `ai` — no new dependencies). `In` is the schema's field types and `Out` is `{ success: boolean; id: string; status: string }` for `remember` and `{ result: string }` for `recall` (the shape of the `neurophic` client's `RetrieveResponse`). The schemas and the `execute` callbacks are unchanged.

### Please check before merging
- `packages/ai-sdk/package.json:1`: AI SDK 7 requires Node.js 22 or later.
- The `Tool<…>` input/output types in the new return annotation duplicate the schema's field types. If the schemas ever change, update both.
- **Widening:** in v6 the inferred `createTools` return had `execute` required (the `tool()` result was an executable tool). In v7, `Tool<In, Out>` declares `execute` optional, so this annotation widens the public type: `remember.execute` and `recall.execute` become `execute?` instead of `execute`. Callers that already invoke these through `ai`'s `streamText`/`generateText` are unaffected (the runtime shape still provides `execute`), but any downstream type that pattern-matches on the presence of `execute` will now see it as optional. Flag if that is a problem for your users.

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
