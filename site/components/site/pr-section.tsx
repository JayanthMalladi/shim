import type { ReactNode } from "react";
import { PullRequestIcon } from "@/components/ai-elements/icons";
import { links } from "@/lib/site";
import { Eyebrow, Lede, SectionTitle, TimelineSection } from "./timeline-section";

function C({ children }: { children: ReactNode }) {
  return <code className="text-fg">{children}</code>;
}

function SourceChip({ label, file, line }: { label: string; file: string; line: number }) {
  return (
    <a
      href="#problem"
      aria-label={`Source: ${file} line ${line}`}
      className="rounded bg-fg-2 px-[5px] py-px font-mono text-[11px] whitespace-nowrap text-ground no-underline hover:bg-amber hover:text-ground"
    >
      {label}
    </a>
  );
}

export function PrSection() {
  return (
    <TimelineSection id="pr" labelledBy="pr-title" className="flex flex-wrap items-start gap-x-16 gap-y-10">
      <div className="min-w-0 flex-[1_1_300px]">
        <Eyebrow>04 · what lands in your repo</Eyebrow>
        <SectionTitle id="pr-title" className="max-w-[14ch]">
          A PR you can skim in a minute.
        </SectionTitle>
        <Lede className="max-w-[40ch]">
          Every fix cites its file and line. Every gate shows before and after. Anything Shim didn&apos;t change is
          listed for you.
        </Lede>
        <p className="mt-6 mb-0 text-[15px] text-muted">
          First PR opened:{" "}
          <a href={links.firstPr} className="font-mono break-all text-fg underline underline-offset-2 hover:text-amber">
            requestyai/ai-sdk-requesty#66
          </a>{" "}
          (open).
        </p>
      </div>

      <article
        aria-labelledby="pr-example-title"
        className="min-w-0 flex-[1.5_1_540px] overflow-hidden rounded-[14px] border border-edge bg-panel"
      >
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-line px-5 py-4">
          <PullRequestIcon className="text-blue" />
          <h3 id="pr-example-title" className="m-0 flex-[1_1_auto] text-[17px] font-semibold">
            Upgrade to AI SDK 7
          </h3>
          <span className="rounded-full border border-edge px-2.5 py-0.5 font-mono text-xs text-muted">example</span>
        </div>
        <div className="flex flex-col gap-[18px] p-5 text-sm text-fg-2">
          <p className="m-0">
            This PR moves the project from AI SDK 6 to 7 and keeps its current behavior. AI SDK 7 changes some values
            without a type error, so the official codemod alone is not enough here.
          </p>
          <div>
            <h4 className="mt-0 mb-2 text-sm font-semibold text-fg">Fixed: same code, different behavior on v7</h4>
            <ul className="m-0 flex list-disc flex-col gap-1.5 pl-[18px]">
              <li>
                <C>result.usage</C> now covers every step. <C>result.finalStep.usage</C> keeps the v6 value.{" "}
                <SourceChip label="lib/agent.ts:24" file="lib/agent.ts" line={24} />
              </li>
              <li>
                <C>response.messages</C> now holds only the final step. Uses <C>responseMessages</C>.{" "}
                <SourceChip label="lib/chat.ts:51" file="lib/chat.ts" line={51} />
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mt-0 mb-2 text-sm font-semibold text-fg">Fixed: would fail at runtime on v7</h4>
            <ul className="m-0 list-disc pl-[18px]">
              <li>
                <C>allowSystemInMessages: true</C> keeps the v6 behavior.{" "}
                <SourceChip label="route.ts:12" file="app/api/chat/route.ts" line={12} />
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mt-0 mb-2 text-sm font-semibold text-fg">How it was checked</h4>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse font-mono text-[13px]">
                <thead>
                  <tr className="text-left text-muted">
                    <th scope="col" className="border-b border-line px-3 py-2 font-medium">
                      Check
                    </th>
                    <th scope="col" className="border-b border-line px-3 py-2 font-medium">
                      Before
                    </th>
                    <th scope="col" className="border-b border-line px-3 py-2 font-medium">
                      After
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row" className="border-b border-line-soft px-3 py-2 text-left font-normal">
                      typecheck
                    </th>
                    <td className="border-b border-line-soft px-3 py-2">pass</td>
                    <td className="border-b border-line-soft px-3 py-2">pass</td>
                  </tr>
                  <tr>
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      test
                    </th>
                    <td className="px-3 py-2">pass</td>
                    <td className="px-3 py-2">pass</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2.5 mb-0 text-[13px] text-muted">
              Also ran <code>npx @ai-sdk/codemod v7</code>. Install ran with <code>--ignore-scripts</code>. A second
              agent reviewed the full diff for behavior changes and unrelated edits.
            </p>
          </div>
          <p className="m-0 border-t border-line pt-3.5 text-[13px] text-muted">
            Rollback: revert this PR. Not useful? Close it and we won&apos;t open another on this repo.
          </p>
        </div>
      </article>
    </TimelineSection>
  );
}
