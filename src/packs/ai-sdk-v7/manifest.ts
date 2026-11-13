import type { PackManifest } from "../../types.js";

/**
 * S05: the declarative record of "this AI SDK 6 -> 7 change breaks this code". One entry per
 * ruleId the ai-sdk-v7 scan path emits (src/rules/ai-sdk-v7.ts + the two src/scan.ts hooks the
 * ai-sdk-v7 entry in src/migrations.ts adds: node-22 and ci-node-version at floor 22). The pipeline
 * codemod-guard rule (codemod-renamed-export) attaches in src/pipeline.ts, not the scan path, so it
 * is intentionally NOT here. Descriptive only: the scanners keep producing byte-identical findings.
 *
 * `source` is the official doc the rule encodes (URL + heading); `change` is the one-line fact.
 * `fixtures` lists real files under test/fixtures/ that already exercise the rule: at least one
 * FLAG case and one must-NOT-flag case, where the rule has both.
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
      fixtures: ["test/fixtures/v6-app/src/legacy.cjs"],
    },
    {
      id: "system-in-messages",
      severity: "break",
      fix: "auto",
      change: "v7 rejects `role: 'system'` in `messages`/`prompt` at runtime unless `allowSystemInMessages` is set.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — System messages in `prompt`/`messages` are rejected by default",
      fixtures: [
        "test/fixtures/v6-app/src/messages.ts",
        "test/fixtures/v6-app/src/system-option.ts",
        "test/fixtures/v6-app/src/agent.ts",
      ],
    },
    {
      id: "maybe-system-in-messages",
      severity: "silent",
      fix: "agent",
      change: "Same v7 system-message rejection, but the call's options are built elsewhere so the scanner can't prove them system-free.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — System messages in `prompt`/`messages` are rejected by default (static-analysis variant)",
      fixtures: ["test/fixtures/v6-app/src/agent.ts", "test/fixtures/v6-app/src/messages.ts", "test/fixtures/v6-app/src/system-option.ts"],
    },
    {
      id: "multi-step-result",
      severity: "silent",
      fix: "auto",
      change: "A multi-step result's step properties now accumulate across every step; read them from `finalStep` to keep the last-step value.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — Multi-step result shape (result properties now include all steps; read from finalStep)",
      fixtures: ["test/fixtures/v6-app/src/agent.ts", "test/fixtures/v6-app/src/usage.ts"],
    },
    {
      id: "maybe-multi-step-result",
      severity: "silent",
      fix: "agent",
      change: "The multi-step accumulation above, on a call whose options may set stopWhen but that the scanner can't see into.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — Multi-step result shape (result properties now include all steps)",
      fixtures: ["test/fixtures/v6-app/src/agent.ts"],
    },
    {
      id: "response-messages",
      severity: "silent",
      fix: "auto",
      change: "`result.response.messages` now holds only the final step's messages; use `responseMessages` for the full history.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — Multi-step result shape (response.messages now holds only the final step)",
      fixtures: ["test/fixtures/v6-app/src/agent.ts"],
    },
    {
      id: "typed-multi-step-result",
      severity: "silent",
      fix: "agent",
      change: "Values declared with an AI SDK result type reach the same accumulating reads, but through a type instead of the producing call.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — Multi-step result shape (result properties now include all steps; agent variant)",
      fixtures: ["test/fixtures/v6-app/src/typed.ts"],
    },
    {
      id: "multi-step-end-event",
      severity: "silent",
      fix: "agent",
      change: "`onFinish`/`onEnd`/`experimental_onFinish` event properties now cover every step, not just the last.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — Multi-step result shape (onEnd result properties changed; onFinish renamed to onEnd)",
      fixtures: ["test/fixtures/v6-app/src/agent.ts"],
    },
    {
      id: "total-usage",
      severity: "deprecated",
      fix: "auto",
      change: "`result.totalUsage` is deprecated; `result.usage` now covers all steps and replaces it.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — usage now includes all steps (`totalUsage` deprecated)",
      fixtures: ["test/fixtures/v6-app/src/agent.ts"],
    },
    {
      id: "usage-flat-token-fields",
      severity: "silent",
      fix: "auto",
      change: "v7 removed the flat `usage.reasoningTokens`/`cachedInputTokens` fields (they read undefined); use the nested `outputTokenDetails`/`inputTokenDetails`.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — cachedInputTokens / reasoningTokens removed from LanguageModelUsage",
      fixtures: [
        "test/fixtures/v6-app/src/usage.ts",
        "test/fixtures/v6-app/src/usage-other.ts",
      ],
    },
    {
      id: "tool-execution-context",
      severity: "break",
      fix: "agent",
      change: "v7's `ToolExecutionOptions` now has a required `context` field; a literal missing it stops type-checking.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — Tools: experimental_context became tool context (per-tool context from contextSchema)",
      fixtures: ["test/fixtures/v6-app/src/tools.ts"],
    },
    {
      id: "telemetry-needs-otel",
      severity: "silent",
      fix: "manual",
      change: "OpenTelemetry moved to `@ai-sdk/otel`; without `registerTelemetry` at startup, traces stop with no error.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — OpenTelemetry moved to @ai-sdk/otel",
      fixtures: ["test/fixtures/v6-app/src/agent.ts"],
    },
    {
      id: "node-22",
      severity: "break",
      fix: "manual",
      change: "AI SDK 7 requires Node.js 22 or later; a lower `engines.node` floor in an ai-dep package.json goes red.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — Minimum Node.js version (22 or later)",
      fixtures: ["test/fixtures/v6-app/package.json"],
    },
    {
      id: "ci-node-version",
      severity: "break",
      fix: "auto",
      change: "CI that pins Node below 22 (workflow or .nvmrc) goes red the moment the AI SDK 7 PR triggers it; rewritten to 22. The workflow rewrite is a Shim addition; the Node 22 floor is the doc's fact.",
      source: "https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 — Minimum Node.js version (22 or later)",
      fixtures: [
        "test/fixtures/v6-app/.github/workflows/ci.yml",
        "test/fixtures/v6-app/.github/workflows/nvmrc.yml",
        "test/fixtures/v6-app/.github/workflows/ok.yml",
        "test/fixtures/v6-app/.github/workflows/publish.yml",
        "test/fixtures/crlf-ci/.github/workflows/ci-crlf.yml",
      ],
    },
  ],
};
