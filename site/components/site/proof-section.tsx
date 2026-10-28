import { CodeBlock } from "@/components/ai-elements/code-block";
import { XCircleIcon } from "@/components/ai-elements/icons";
import { ToolBadge } from "@/components/ai-elements/tool";
import { Eyebrow, SectionTitle, TimelineSection } from "./timeline-section";

const stats: Array<[string, string]> = [
  ["repos attempted, night one", "23"],
  ["pr-ready, night one", "11 · 48%"],
  ["pr-ready, two nights", "16"],
  ["agent cost per repo", "$0.06–$5.63"],
  ["v6 packages self-migrated, ~6 wks", "12 / 45"],
];

export function ProofSection() {
  return (
    <TimelineSection id="proof" labelledBy="proof-title">
      <Eyebrow>03 · first overnight runs</Eyebrow>
      <SectionTitle id="proof-title" className="max-w-[22ch]">
        Green gates aren&apos;t a verdict.
      </SectionTitle>

      <div className="mt-10 flex flex-wrap gap-4">
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-4 rounded-[14px] border border-edge-strong bg-proof p-7">
          <div className="flex flex-wrap items-baseline gap-4">
            <span className="text-[clamp(96px,10vw,140px)] leading-[0.85] font-semibold tracking-[-0.05em] text-amber tabular-nums">
              5
            </span>
            <span className="font-mono text-[13px] text-muted">judge rejections</span>
          </div>
          <p className="m-0 max-w-[30ch] text-[19px] leading-[1.4]">
            diffs passed every test and every typecheck. The judge rejected them anyway. Without it, five wrong PRs.
          </p>
        </div>

        <dl className="m-0 min-w-0 flex-[1_1_380px] rounded-[14px] border border-line bg-panel px-6 py-2 font-mono text-sm">
          {stats.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-line-soft py-3.5 last:border-b-0">
              <dt className="text-muted">{k}</dt>
              <dd className="m-0 shrink-0 text-right text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-4 overflow-hidden rounded-[14px] border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-line px-[18px] py-3.5">
          <XCircleIcon label="Rejected" />
          <span className="font-mono text-sm">judge</span>
          <ToolBadge tone="rejected">rejected</ToolBadge>
          <span className="flex-[1_1_200px] text-[13px] text-muted">
            Illustrative verdict. typecheck pass → pass · test pass → pass
          </span>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-5 px-[18px] py-4">
          <p className="m-0 flex-[1_1_320px] text-[15px] text-fg-2">
            Candidate 2 left <code className="text-fg">event.usage</code> as is in an{" "}
            <code className="text-fg">onFinish</code> handler. On v7 that sums every step, so the billing callback
            reports more tokens than v6 did. The tests mock a one-step model, so they can&apos;t see it.
          </p>
          <CodeBlock
            variant="inset"
            className="flex-[1_1_320px] overflow-hidden rounded-[10px] border border-line bg-inset"
            code={`onFinish: (event) => {
  bill(event.usage);
},
// expected: event.finalStep.usage`}
            highlight={[2]}
            notes={[4]}
          />
        </div>
      </div>
    </TimelineSection>
  );
}
