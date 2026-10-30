# Draft issue for vercel/ai

**Title:** codemod v7 `rename-google-generative-ai-to-google` breaks aliased imports and renames user exports

**Body:**

`@ai-sdk/codemod@4.0.3`, transform `v7/rename-google-generative-ai-to-google`.

The second pass renames every identifier in the file whose name contains `GoogleGenerativeAI`, whatever it is bound to. It skips identifiers inside an `ImportSpecifier`, so an aliased import keeps its local name while every reference to that alias gets renamed. The output doesn't compile. The same pass also renames the file's own exports.

Input (from cloudflare/ai, `packages/ai-gateway-provider/src/providers/google.ts`):

```ts
import { createGoogleGenerativeAI as createGoogleGenerativeAIOriginal } from "@ai-sdk/google";

export const createGoogleGenerativeAI = (
  ...args: Parameters<typeof createGoogleGenerativeAIOriginal>
) => authWrapper(createGoogleGenerativeAIOriginal)(...args);
```

Output:

```ts
import { createGoogle as createGoogleGenerativeAIOriginal } from "@ai-sdk/google";

export const createGoogle = (
  ...args: Parameters<typeof createGoogleOriginal>   // not defined
) => authWrapper(createGoogleOriginal)(...args);     // not defined
```

There are two problems:

1. References to the alias are renamed (`createGoogleGenerativeAIOriginal` becomes `createGoogleOriginal`) but the alias itself is not, which leaves undefined names.
2. The package's own public export `createGoogleGenerativeAI` is renamed to `createGoogle`, along with its re-export in `providers/index.ts`. That's a breaking change for the package's users that v7 doesn't require.

Expected: rename only the `imported` name in the specifier, keep the existing local binding when there is an alias, and rename only identifiers that resolve to an unaliased import from `@ai-sdk/google`.

Found by [Shim](https://github.com/JayanthMalladi/shim) while upgrading open-source repos to AI SDK 7. Happy to send a PR with a fix and a test.

---

Notes for Jayanth/Shekhar (not part of the issue):
- This is a good opener for a conversation with the AI SDK team: "we ran your codemod on N repos; here is what it gets wrong, and here is what we catch."
- Other codemod over-edits we've seen: in Requesty it changed `'media'` to `'file-data'` in a test typed against an older provider spec.
- Before posting, re-check the bug on the latest `@ai-sdk/codemod` in case it's already fixed.
