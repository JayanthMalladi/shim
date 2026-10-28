import { ArrowRightIcon } from "@/components/ai-elements/icons";
import { links, migrateCommand, placeholders, scanCommand } from "@/lib/site";
import { PlaceholderText, SiteLink } from "./placeholder";
import { Eyebrow, SectionTitle, TimelineSection } from "./timeline-section";

export function StartSection() {
  return (
    <TimelineSection id="start" labelledBy="start-title" last>
      <Eyebrow>05 · your turn</Eyebrow>
      <SectionTitle id="start-title">Find your silent changes first.</SectionTitle>
      <div className="mt-8 max-w-[760px] rounded-[14px] border border-edge-strong bg-panel">
        <label htmlFor="cmd" className="block px-[18px] pt-3.5 text-[13px] text-muted">
          Run in your repo
        </label>
        <input
          id="cmd"
          type="text"
          readOnly
          value={scanCommand}
          spellCheck={false}
          className="box-border block w-full rounded-none border-0 bg-transparent px-[18px] pt-2 pb-4 font-mono text-lg text-fg outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 pr-3 pl-[18px]">
          <span className="font-mono text-[13px] text-muted">then: {migrateCommand}</span>
          <div className="flex flex-wrap gap-2">
            <SiteLink
              href={links.githubApp}
              className="btn-ghost inline-flex min-h-11 items-center rounded-[10px] border border-edge-strong px-4 text-sm text-fg no-underline hover:text-fg"
            >
              Install GitHub App
            </SiteLink>
            <SiteLink
              href={links.waitlist}
              className="btn-amber inline-flex min-h-11 items-center gap-2 rounded-[10px] px-[18px] text-sm font-semibold no-underline"
            >
              Join waitlist
              <ArrowRightIcon />
            </SiteLink>
          </div>
        </div>
      </div>
      <p className="mt-4 mb-0 text-sm text-muted">
        Pricing: <PlaceholderText>{placeholders.price}</PlaceholderText>
      </p>
    </TimelineSection>
  );
}
