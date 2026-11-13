import type { PackManifest } from "../../types.js";

/**
 * S05: the declarative record of "this AI SDK 6 -> 7 change breaks this code". One entry per
 * ruleId the ai-sdk-v7 scan path emits (src/rules/ai-sdk-v7.ts + the two src/scan.ts hooks the
 * ai-sdk-v7 entry in src/migrations.ts adds: node-22 and ci-node-version at floor 22). The pipeline
 * codemod-guard rule (codemod-renamed-export) attaches in src/pipeline.ts, not the scan path, so it
 * is intentionally NOT here. Descriptive only: the scanners keep producing byte-identical findings.
 *
 * `source` is the official doc the rule encodes (URL + heading); `change` is the one-line fact.
 *
 * `flag` lists the fixture files the rule fires on; `noFlag` lists the files that hold a
 * must-NOT-flag case for the rule — a fire-file with an asserted not-flag line, or a whole file the
 * rule stays silent on. A fire-file that carries a not-flag case may appear in both. Rules with no
 * scoped must-NOT-flag case (the PR #69 gap list: telemetry-needs-otel, esm-only, response-messages,
 * total-usage, node-22) list only the flag side, with `noFlag: []`. A path is never invented.
 */
export const aiSdkV7: PackManifest = {
  id: "ai-sdk-v7",
  package: "ai",
  from: "^6.0.0",
  to: "^7.0.0",
  rules: [
    {
      id: "esm-only",
      severity: "break",
      fix: "agent",
      change: "AI SDK 7 packages are ESM-only; `require('ai')` / `require('@ai-sdk/*')` throws at runtime.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — ESM Only (CommonJS support removed)",
      flag: ["test/fixtures/v6-app/src/legacy.cjs"],
      // No scoped must-NOT-flag case: a lone .cjs `require('ai')` with no CJS/ESM contrast in the fixture.
      noFlag: [],
    },
    {
      id: "system-in-messages",
      severity: "break",
      fix: "auto",
      change: "v7 rejects `role: 'system'` in `messages`/`prompt` at runtime unless `allowSystemInMessages` is set.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — System messages in `prompt`/`messages` are rejected by default",
      flag: ["test/fixtures/v6-app/src/agent.ts", "test/fixtures/v6-app/src/messages.ts", "test/fixtures/v6-app/src/system-option.ts"],
      // Each fire-file also holds an asserted not-flag line (messages.ts:32, system-option.ts:17/22, agent.ts single/conditional steps).
      noFlag: ["test/fixtures/v6-app/src/agent.ts", "test/fixtures/v6-app/src/messages.ts", "test/fixtures/v6-app/src/system-option.ts"],
    },
    {
      id: "maybe-system-in-messages",
      severity: "silent",
      fix: "agent",
      change: "Same v7 system-message rejection, but the call's options are built elsewhere so the scanner can't prove them system-free.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — System messages in `prompt`/`messages` are rejected by default (static-analysis variant)",
      flag: ["test/fixtures/v6-app/src/agent.ts", "test/fixtures/v6-app/src/messages.ts", "test/fixtures/v6-app/src/system-option.ts"],
      // The provably-system-free calls in these same files (string prompts, literal user messages) must not be sent to the agent.
      noFlag: ["test/fixtures/v6-app/src/agent.ts", "test/fixtures/v6-app/src/messages.ts", "test/fixtures/v6-app/src/system-option.ts"],
    },
    {
      id: "multi-step-result",
      severity: "silent",
      fix: "auto",
      change: "A multi-step result's step properties now accumulate across every step; read them from `finalStep` to keep the last-step value.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — Multi-step result shape (result properties now include all steps; read from finalStep)",
      flag: ["test/fixtures/v6-app/src/agent.ts", "test/fixtures/v6-app/src/usage.ts"],
      // agent.ts singleStep: a single-step `result.usage` read must not be rewritten.
      noFlag: ["test/fixtures/v6-app/src/agent.ts"],
    },
    {
      id: "maybe-multi-step-result",
      severity: "silent",
      fix: "agent",
      change: "The multi-step accumulation above, on a call whose options may set stopWhen but that the scanner can't see into.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — Multi-step result shape (result properties now include all steps)",
      flag: ["test/fixtures/v6-app/src/agent.ts"],
      // agent.ts conditionalSpreads: a spread of inline literals is transparent (single step), not maybe-multi-step.
      noFlag: ["test/fixtures/v6-app/src/agent.ts"],
    },
    {
      id: "response-messages",
      severity: "silent",
      fix: "auto",
      change: "`result.response.messages` now holds only the final step's messages; use `responseMessages` for the full history.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — Multi-step result shape (response.messages now holds only the final step)",
      flag: ["test/fixtures/v6-app/src/agent.ts"],
      // No scoped must-NOT-flag case: the one `response.messages` read is always the flag.
      noFlag: [],
    },
    {
      id: "typed-multi-step-result",
      severity: "silent",
      fix: "agent",
      change: "Values declared with an AI SDK result type reach the same accumulating reads, but through a type instead of the producing call.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — Multi-step result shape (result properties now include all steps; agent variant)",
      flag: ["test/fixtures/v6-app/src/typed.ts"],
      // typed.ts textOnly (`.text`) and the repo's own types (Totals/billing) must not be flagged.
      noFlag: ["test/fixtures/v6-app/src/typed.ts"],
    },
    {
      id: "multi-step-end-event",
      severity: "silent",
      fix: "agent",
      change: "`onFinish`/`onEnd`/`experimental_onFinish` event properties now cover every step, not just the last.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — Multi-step result shape (onEnd result properties changed; onFinish renamed to onEnd)",
      flag: ["test/fixtures/v6-app/src/agent.ts"],
      // agent.ts conditionalSpreads: a single-step call's event read must not be rewritten.
      noFlag: ["test/fixtures/v6-app/src/agent.ts"],
    },
    {
      id: "total-usage",
      severity: "deprecated",
      fix: "auto",
      change: "`result.totalUsage` is deprecated; `result.usage` now covers all steps and replaces it.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — usage now includes all steps (`totalUsage` deprecated)",
      flag: ["test/fixtures/v6-app/src/agent.ts"],
      // No scoped must-NOT-flag case: agent.ts:20 is the only `result.totalUsage` read.
      noFlag: [],
    },
    {
      id: "usage-flat-token-fields",
      severity: "silent",
      fix: "auto",
      change: "v7 removed the flat `usage.reasoningTokens`/`cachedInputTokens` fields (they read undefined); use the nested `outputTokenDetails`/`inputTokenDetails`.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — cachedInputTokens / reasoningTokens removed from LanguageModelUsage",
      // usage.ts holds the flat reads; usage-other.ts has no `ai` import, so its flat reads are the repo's own object and must not fire.
      flag: ["test/fixtures/v6-app/src/usage.ts"],
      // usage.ts:33 (already-nested) and :38 (OpenAI snake_case) are not flagged; usage-other.ts:5 is not an AI SDK read.
      noFlag: ["test/fixtures/v6-app/src/usage.ts", "test/fixtures/v6-app/src/usage-other.ts"],
    },
    {
      id: "tool-execution-context",
      severity: "break",
      fix: "agent",
      change: "v7's `ToolExecutionOptions` now has a required `context` field; a literal missing it stops type-checking.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — Tools: experimental_context became tool context (per-tool context from contextSchema)",
      flag: ["test/fixtures/v6-app/src/tools.ts"],
      // tools.ts:18/28 (context present) and :36/42 (virtual-CLI/toolCallId, not ai's options) must not be flagged.
      noFlag: ["test/fixtures/v6-app/src/tools.ts"],
    },
    {
      id: "telemetry-needs-otel",
      severity: "silent",
      fix: "manual",
      change: "OpenTelemetry moved to `@ai-sdk/otel`; without `registerTelemetry` at startup, traces stop with no error.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — OpenTelemetry moved to @ai-sdk/otel",
      flag: ["test/fixtures/v6-app/src/agent.ts"],
      // No scoped must-NOT-flag case: the telemetry-enabled contrast is not in the fixture.
      noFlag: [],
    },
    {
      id: "node-22",
      severity: "break",
      fix: "manual",
      change: "AI SDK 7 requires Node.js 22 or later; a lower `engines.node` floor in an ai-dep package.json goes red.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — Minimum Node.js version (22 or later)",
      flag: ["test/fixtures/v6-app/package.json"],
      // No scoped must-NOT-flag case: the fixture's only package.json is below 22, so it is always the flag.
      noFlag: [],
    },
    {
      id: "ci-node-version",
      severity: "break",
      fix: "auto",
      change: "CI that pins Node below 22 (workflow or .nvmrc) goes red the moment the AI SDK 7 PR triggers it; rewritten to 22. The workflow rewrite is a Shim addition; the Node 22 floor is the doc's fact.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — Minimum Node.js version (22 or later)",
      // ci.yml / nvmrc.yml pin below 22 (flag); the CRLF crlf-ci workflow fires too. ok.yml (22, lts/*) and the
      // release-only publish.yml are the must-NOT-flag workflows.
      flag: [
        "test/fixtures/v6-app/.github/workflows/ci.yml",
        "test/fixtures/v6-app/.github/workflows/nvmrc.yml",
        "test/fixtures/crlf-ci/.github/workflows/ci-crlf.yml",
      ],
      noFlag: [
        "test/fixtures/v6-app/.github/workflows/ok.yml",
        "test/fixtures/v6-app/.github/workflows/publish.yml",
      ],
    },
  ],
};
