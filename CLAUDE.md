# Shim

Shim turns API breaking changes into tested PRs. First migration: AI SDK 6 -> 7.

## Commands
- `npm test` runs vitest. `npm run typecheck` runs tsc.
- `npx tsx src/cli.ts scan|fix|migrate <dir>`.

## Rules
- Fixes must preserve the target repo's current runtime behavior. Prefer a deterministic rewrite in `src/rules/` over the agent.
- Every new rule gets a fixture case in `test/fixtures/v6-app` and an assertion in `test/scan.test.ts`, including a case that must not be flagged.
- Never open a PR unless every gate that passed at baseline still passes (`src/gates.ts`). Otherwise open an issue.
- Installs of target repos always use `--ignore-scripts`.
- Keep replies and PR text short and specific; maintainers skim.
