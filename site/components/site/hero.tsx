import { links, scanCommand } from "@/lib/site";
import { CopyCommand } from "./copy-command";
import { HeroTranscript } from "./hero-transcript";
import { SiteLink } from "./placeholder";

export function Hero() {
  return (
    <section
      id="top"
      aria-labelledby="hero-title"
      className="mx-auto box-border flex max-w-[1280px] flex-wrap items-start gap-14 px-[clamp(16px,4vw,48px)] pt-[72px] pb-24"
    >
      <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-7 pt-6">
        <div className="flex items-center gap-2.5 font-mono text-[13px] text-muted">
          <span aria-hidden="true" className="block size-2 rounded-full bg-amber" />
          <span>First migration: Vercel AI SDK 6 → 7</span>
        </div>
        <h1
          id="hero-title"
          className="m-0 text-[clamp(44px,5.6vw,76px)] leading-[1.02] font-semibold tracking-[-0.035em] text-balance"
        >
          Your tests pass. <span className="text-amber">Your behavior changed.</span>
        </h1>
        <p className="m-0 max-w-[36ch] text-[19px] text-fg-3">
          Shim migrates AI SDK 6 apps to 7 and opens a tested pull request. The official codemod does the renames.
          Shim fixes the changes that still compile but return different data.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <SiteLink
            href={links.waitlist}
            className="btn-amber inline-flex min-h-12 items-center rounded-[10px] px-[22px] font-semibold no-underline"
          >
            Join the waitlist
          </SiteLink>
          <CopyCommand command={scanCommand} />
        </div>
        <p className="m-0 text-sm text-muted">The scan is read-only. It lists every silent change with file and line.</p>
      </div>

      <HeroTranscript />
    </section>
  );
}
