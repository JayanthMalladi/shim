## Upgrade to AI SDK 7

This PR moves the project from AI SDK 6 to 7 and keeps its current behavior, except where noted under "Needs your eyes".

### Versions
- `@ai-sdk/anthropic`: ^3.0.64 → ^4.0.0
- `@ai-sdk/cohere`: ^3.0.27 → ^4.0.0
- `@ai-sdk/deepseek`: ^2.0.26 → ^3.0.0
- `@ai-sdk/google`: ^3.0.54 → ^4.0.0
- `@ai-sdk/groq`: ^3.0.31 → ^4.0.0
- `@ai-sdk/mistral`: ^3.0.27 → ^4.0.0
- `@ai-sdk/openai-compatible`: ^2.0.37 → ^3.0.0
- `@ai-sdk/openai`: ^3.0.48 → ^4.0.0
- `@ai-sdk/perplexity`: ^3.0.26 → ^5.0.0
- `@ai-sdk/togetherai`: ^2.0.41 → ^3.0.0
- `@ai-sdk/xai`: ^3.0.74 → ^5.0.0
- `@openrouter/ai-sdk-provider`: ^2.3.3 → ^3.1.0
- `ai`: ^6.0.141 → ^7.0.0

This drops support for AI SDK 6, so users of this package will need AI SDK 7 too. It probably belongs in a new major version.

`@openrouter/ai-sdk-provider` is bumped because v2 peers on `ai@^6.0.0`; with `ai@7` in the tree, `npm install` fails with `ERESOLVE` unless the provider is on v3 (which peers on `ai@^7.0.0`).

### What changed and why
Source files changed (codemod renames and fixer edits): `src/provider-factory.ts`, `tests/provider-factory.test.ts`.

After the codemod, these checks failed; this PR fixes them: `typecheck .`, `test .`.

Specifically:
- `src/provider-factory.ts`: the `@ai-sdk/google` export `createGoogleGenerativeAI` was renamed to `createGoogle` in v4.
- `src/provider-factory.ts`: `system` was renamed to `instructions` in AI SDK 7. `allowSystemInMessages: true` is also set on the shared options builder so a `system` string still passed inside `messages` keeps working exactly as in v6.
- `tests/provider-factory.test.ts`: the mocked `@ai-sdk/google` factory was renamed to match.

### Needs your eyes
Shim did not change these. Please check them before merging.
- `package.json:1`: AI SDK 7 requires Node.js 22 or later.
- `src/provider-factory.ts:64` and `src/provider-factory.ts:100`: these calls' options are built by `buildBaseTextCallOptions` (line ~155), so Shim set `allowSystemInMessages: true` there to keep v6 behaviour. **Can you confirm the `system` value never arrives inside `messages`?** If it does, `allowSystemInMessages: true` is what keeps v7 from rejecting the request — please confirm you are happy with that flag staying.
- `src/provider-factory.ts:72` and `src/provider-factory.ts:77`: these read `result.usage` and `result.warnings` from a `generateText` call whose options are built elsewhere. **If `stopWhen` is ever set, AI SDK 7 makes `usage` and `warnings` span every step instead of only the last one — do you want `result.finalStep.usage` / `result.finalStep.warnings` here to keep the v6 values?**
- `src/provider-factory.ts:105` and `src/provider-factory.ts:108`: the streaming path reads `result.totalUsage` (deprecated in AI SDK 7) and `result.warnings`. **Should these become `result.usage` / `result.finalStep.warnings`, or is the step-spanning behaviour you want?** Shim left the code alone here because the right answer depends on how the router consumes multi-step results.

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
