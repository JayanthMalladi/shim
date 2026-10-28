import type { ReactNode } from "react";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { PullRequestIcon } from "@/components/ai-elements/icons";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import {
  StreamRow,
  Tool,
  ToolBadge,
  ToolContent,
  ToolHeader,
  ToolOutput,
} from "@/components/ai-elements/tool";

function C({ children }: { children: ReactNode }) {
  return <code className="font-mono text-fg">{children}</code>;
}

const findings = [
  { site: "lib/agent.ts:24", rule: "multi-step-result" },
  { site: "lib/chat.ts:51", rule: "response-messages" },
  { site: "app/api/chat/route.ts:12", rule: "system-in-messages" },
];

/**
 * The hero's example run. Rows stream in on load (CSS-timed so the static
 * HTML is complete without JS); prefers-reduced-motion shows everything at once.
 */
export function HeroTranscript() {
  return (
    <div
      role="region"
      aria-label="Example run of shim migrate"
      className="min-w-0 flex-[1.25_1_560px] overflow-hidden rounded-[14px] border border-edge bg-panel"
    >
      <Message from="user">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 font-mono text-[13px]">
          <span className="text-fg">shim migrate . --agent</span>
          <span className="text-muted">example run · your-app</span>
        </div>
      </Message>

      <Message from="assistant">
        <MessageContent className="py-2 text-sm">
          <StreamRow index={0}>
            <Tool>
              <ToolHeader
                streaming
                title="baseline"
                state="output-available"
                description="install --ignore-scripts · typecheck, test"
                truncate
                badge={<ToolBadge>2 gates green</ToolBadge>}
              />
              <ToolContent>
                <ToolOutput output="Only gates that pass here are held to account later." />
              </ToolContent>
            </Tool>
          </StreamRow>

          <StreamRow index={1}>
            <Tool>
              <ToolHeader
                streaming
                title="upgrade"
                state="output-available"
                description="ai → ^7 · npx @ai-sdk/codemod v7"
                truncate
              />
              <ToolContent>
                <ToolOutput output="The official codemod handles the renames." />
              </ToolContent>
            </Tool>
          </StreamRow>

          <StreamRow index={2}>
            <Tool defaultOpen>
              <ToolHeader streaming title="find" state="output-available" description="3 sites the codemod missed" />
              <ToolContent>
                <ToolOutput
                  output={
                    <ul className="m-0 flex list-none flex-col gap-1.5 p-0 font-mono">
                      {findings.map((f) => (
                        <li key={f.site} className="flex flex-wrap gap-x-3 gap-y-1">
                          <span className="text-fg">{f.site}</span>
                          <span className="text-muted">{f.rule}</span>
                        </li>
                      ))}
                    </ul>
                  }
                />
              </ToolContent>
            </Tool>
          </StreamRow>

          <StreamRow index={3}>
            <Tool>
              <ToolHeader
                streaming
                title="fix"
                state="output-available"
                description="3 deterministic rewrites · agent not needed"
              />
              <ToolContent>
                <ToolOutput output="When a rule can't rewrite safely, a headless agent drafts several candidates in parallel." />
              </ToolContent>
            </Tool>
          </StreamRow>

          <StreamRow index={4}>
            <Tool>
              <ToolHeader
                streaming
                title="check"
                state="output-available"
                description="typecheck pass → pass · test pass → pass"
              />
              <ToolContent>
                <ToolOutput output="Every gate green at baseline is still green." />
              </ToolContent>
            </Tool>
          </StreamRow>

          <StreamRow index={5}>
            <Tool defaultOpen>
              <ToolHeader
                streaming
                title="judge"
                state="approval-responded"
                description="independent review of the diff"
                badge={<ToolBadge tone="approved">approved</ToolBadge>}
              />
              <ToolContent>
                <Reasoning>
                  <ReasoningTrigger />
                  <ReasoningContent>
                    <ul className="m-0 flex list-disc flex-col gap-1.5 pt-2.5 pr-3 pb-3 pl-[30px]">
                      <li>
                        <C>finalStep.usage</C> on a <C>stopWhen</C> call reads the same number v6 did.
                      </li>
                      <li>
                        <C>responseMessages</C> keeps every step in the stored history.
                      </li>
                      <li>
                        <C>allowSystemInMessages</C> keeps the existing system message working.
                      </li>
                      <li>No edits outside the three sites.</li>
                    </ul>
                  </ReasoningContent>
                </Reasoning>
              </ToolContent>
            </Tool>
          </StreamRow>

          <StreamRow index={6}>
            <div className="mx-4 mt-3.5 mb-2 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-edge-strong bg-raised p-4">
              <PullRequestIcon size={20} className="text-amber" />
              <div className="min-w-0 flex-[1_1_200px]">
                <div className="text-[15px] font-semibold">Upgrade to AI SDK 7</div>
                <div className="font-mono text-xs text-muted">
                  3 files · <span className="text-blue">+3</span> <span className="text-amber">−2</span> · ready to
                  open
                </div>
              </div>
              <a
                href="#pr"
                className="inline-flex min-h-10 items-center rounded-lg border border-edge-strong px-3.5 text-sm text-fg no-underline"
              >
                View PR body
              </a>
            </div>
          </StreamRow>

          <StreamRow index={7}>
            <div className="px-4 pt-1.5 pb-2.5 font-mono text-[13px] text-faint">
              done
              <span aria-hidden="true" className="caret text-amber">
                ▍
              </span>
            </div>
          </StreamRow>
        </MessageContent>
      </Message>
    </div>
  );
}
