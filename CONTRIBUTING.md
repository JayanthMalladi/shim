# Contributing

Thanks for helping. Small, focused PRs are easiest to review.

## Run it locally

Shim needs Node 22 or later.

```sh
git clone https://github.com/JayanthMalladi/shim.git
cd shim
npm install
npx tsx src/cli.ts scan path/to/an/ai-sdk-6-app
```

## Run the checks

```sh
npm test            # vitest
npm run typecheck   # tsc
```

## Adding or changing a rule

Rules live in `src/rules/`. Prefer a deterministic rewrite over the agent, and keep the app's current runtime behavior.

Every new rule needs:
- a fixture case in `test/fixtures/v6-app`,
- an assertion in `test/scan.test.ts`,
- a case that must **not** be flagged.

## Opening a PR

1. Branch from `main`.
2. Run `npm test` and `npm run typecheck`.
3. Say what changed and why in a few lines. Link the issue if there is one.

Found a v7 change Shim misses? Open an issue with a short code sample. That is the most useful report.
