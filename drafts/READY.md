# Ready PR drafts

Checklist for opening PRs by hand. Each draft is in `drafts/<owner>__<repo>/` (`pr.md` = body, `changes.patch` = full diff incl. lockfile; apply with `git apply` on a fresh clone of the default branch). Drafts were made against each repo's HEAD on 2026-10-28; check the repo has not moved before opening. Nothing has been opened or pushed upstream.

## Ready

Baseline gates all still pass, judge approved, and the patch/pr.md check found nothing to flag.

- [ ] [aws/bedrock-agentcore-sdk-typescript](https://github.com/aws/bedrock-agentcore-sdk-typescript) | deps-only | checks green 4/4 | draft: `drafts/aws__bedrock-agentcore-sdk-typescript/` | Needs your eyes: `package.json:1` AI SDK 7 requires Node.js 22 or later.
- [ ] [zeabur/ai-sdk](https://github.com/zeabur/ai-sdk) | deps-only | checks green 3/3 | draft: `drafts/zeabur__ai-sdk/` | Needs your eyes: none
- [ ] [merge-api/merge-gateway-ai-sdk-provider](https://github.com/merge-api/merge-gateway-ai-sdk-provider) | deps-only | checks green 4/4 | draft: `drafts/merge-api__merge-gateway-ai-sdk-provider/` | Needs your eyes: `package.json:1` AI SDK 7 requires Node.js 22 or later.
- [ ] [apertis-ai/apertis-sdk](https://github.com/apertis-ai/apertis-sdk) | deps-only | checks green 4/4 | draft: `drafts/apertis-ai__apertis-sdk/` | Needs your eyes: `package.json:1` AI SDK 7 requires Node.js 22 or later.
- [ ] [VoxellInc/forge-ai-provider](https://github.com/VoxellInc/forge-ai-provider) | deps-only | checks green 4/4 | draft: `drafts/VoxellInc__forge-ai-provider/` | Needs your eyes: none
- [ ] [voightxyz/voight-vercel-ai](https://github.com/voightxyz/voight-vercel-ai) | deps-only | checks green 4/4 | draft: `drafts/voightxyz__voight-vercel-ai/` | Needs your eyes: `package.json:1` AI SDK 7 requires Node.js 22 or later.
- [ ] [nkwib/toolroute](https://github.com/nkwib/toolroute) | code | checks green 4/4 | draft: `drafts/nkwib__toolroute/` | Needs your eyes: `package.json:1` AI SDK 7 requires Node.js 22 or later.
- [ ] [xtruder/opencode-claude-max-plugin](https://github.com/xtruder/opencode-claude-max-plugin) | code | checks green 3/3 | draft: `drafts/xtruder__opencode-claude-max-plugin/` | Needs your eyes: none
- [ ] [frayme-ai/frayme-sdk](https://github.com/frayme-ai/frayme-sdk) | code | checks green 7/7 | draft: `drafts/frayme-ai__frayme-sdk/` | Needs your eyes: `packages/api/package.json:1` AI SDK 7 requires Node.js 22 or later.; `packages/runtime/package.json:1` AI SDK 7 requires Node.js 22 or later.
- [ ] [aorizondo/opencode-claude-code-acpbridge](https://github.com/aorizondo/opencode-claude-code-acpbridge) | code | checks green 4/4 | draft: `drafts/aorizondo__opencode-claude-code-acpbridge/` | Needs your eyes: `package.json:1` AI SDK 7 requires Node.js 22 or later.
- [ ] [jodit/jodit-ai-adapter](https://github.com/jodit/jodit-ai-adapter) | code | checks green 3/3 | draft: `drafts/jodit__jodit-ai-adapter/` | Needs your eyes: `package.json:1` AI SDK 7 requires Node.js 22 or later.
- [ ] [ChainFuse/packages](https://github.com/ChainFuse/packages) | code | checks green 3/3 | draft: `drafts/ChainFuse__packages/` | Needs your eyes: none

## Needs review before opening

Gates and judge passed, but a read of the patch/pr.md found something a human should check first (see `status.txt` in each folder).

- [ ] [yadimon/prio-llm-router](https://github.com/yadimon/prio-llm-router) | code | checks green 4/4 | draft: `drafts/yadimon__prio-llm-router/` | Needs your eyes: `package.json:1` AI SDK 7 requires Node.js 22 or later.
  - Why: pr.md overclaims: lists 6 findings under 'Fixed' (provider-factory.ts lines 64,72,77,100,105,108) but the diff only adds allowSystemInMessages/instructions at ~line 158 and renames createGoogle; usage/warnings reads (72,77,108) and totalUsage (105) are not changed in the diff, so possibly unfixed multi-step reads on options built elsewhere. Needs a manual look before opening.
- [ ] [neurophic/neurophic-sdk-js](https://github.com/neurophic/neurophic-sdk-js) | code | checks green 4/4 | draft: `drafts/neurophic__neurophic-sdk-js/` | Needs your eyes: `packages/ai-sdk/package.json:1` AI SDK 7 requires Node.js 22 or later.
  - Why: Fixer hand-wrote an explicit return type on exported createTools (Tool<...> for remember/recall) plus a new RetrieveResponse import in packages/ai-sdk/src/tools.ts; this widens the public type (Tool has optional execute) and pr.md only says 'the codemod's renames covered the code changes'. Check consumer typing before opening.
- [ ] [KrzysztofMarmol/mjml-agent-editor](https://github.com/KrzysztofMarmol/mjml-agent-editor) | code | checks green 7/7 | draft: `drafts/KrzysztofMarmol__mjml-agent-editor/` | Needs your eyes: `packages/agent-node/package.json:1` AI SDK 7 requires Node.js 22 or later.; `packages/editor/package.json:1` AI SDK 7 requires Node.js 22 or later.
  - Why: Non-mechanical edits not explained in pr.md: removed explicit generics from 10 tool<...>() calls in agent-node/src/tools.ts (file with no findings), remapped cachedInputTokens to inputTokenDetails.cacheReadTokens without optional chaining in handler.ts, and dropped cachedInputTokens from sumUsage. Review those before opening.
- [ ] [upstash/context7](https://github.com/upstash/context7) | code | checks green 4/4 | draft: `drafts/upstash__context7/` | Needs your eyes: none
  - Why: Fixer added hand-written Tool<...> return annotations to exported queryDocs/resolveLibraryId (public type widened, execute optional) and rewrote test reads to result.finalStep.*; pr.md does not mention the annotations. Check consumer typing before opening.

## Not ready (no PR; see status.txt)

- HoudiniSwap/houdiniswap-agent: gates regressed: build, typecheck packages/ai-tools
- muxinc/ai: judge rejected
- dpuyosa/venice-ai-sdk-provider: gates regressed: build, typecheck .
- echoVic/blade-agent-sdk: judge rejected
- ashwinpaulallen/ottrix: gates regressed: typecheck ., typecheck packages/vercel-ai
