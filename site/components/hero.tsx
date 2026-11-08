import { links } from "@/lib/site";
import { prList, proof } from "@/lib/stats";

/** The wobbly table: ai@7 sits on it, the wedge slides under the short leg, the table levels. */
function Scene() {
  return (
    <div aria-hidden="true" className="h-[311px] w-[340px] sm:h-[420px] sm:w-[460px]">
      <div className="scene">
        <div className="tilt">
          <div className="absolute top-[120px] right-10 left-10 h-7 rounded-lg border-[3px] border-ink bg-paper shadow-[6px_6px_0_#111]">
            <div className="absolute -top-[88px] left-1/2 grid h-[84px] w-[132px] -translate-x-1/2 place-items-center rounded-t-xl rounded-b-3xl border-[3px] border-ink bg-wedge font-mono text-lg">
              ai@7
            </div>
          </div>
          <div className="absolute top-[148px] left-20 h-[204px] w-[22px] border-[3px] border-ink bg-paper" />
          <div className="absolute top-[148px] right-20 h-[174px] w-[22px] border-[3px] border-ink bg-paper" />
        </div>
        <svg className="wedge-in absolute top-[296px] right-[30px]" width="140" height="56" viewBox="0 0 140 56">
          <path d="M4 52 L136 6 L136 52 Z" fill="#FF6B3D" stroke="#111111" strokeWidth="3" strokeLinejoin="round" />
        </svg>
        <div className="absolute top-[352px] right-0 left-0 h-[3px] bg-ink" />
        <span className="absolute top-[364px] right-0 font-mono text-sm">← that&apos;s shim</span>
        <span className="sticker level top-[380px] left-1/2 -ml-[60px] bg-mint">level ✓</span>
        <span className="sticker top-0 left-0 -rotate-[8deg] bg-paper">{prList.length} PRs open upstream</span>
        <span className="sticker top-6 right-0 rotate-6 bg-mint">{proof.headline} bad diffs caught</span>
        <span className="sticker top-[270px] left-10 rotate-[4deg] bg-paper">tests stay green</span>
        <span className="sticker top-[190px] right-0 -rotate-[3deg] bg-wedge">fix merged by Vercel ✓</span>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-title" className="px-4 pt-12 pb-24 sm:px-8">
      <div className="mx-auto flex max-w-[1184px] flex-wrap items-center justify-center gap-12 lg:justify-between">
        <div className="flex max-w-[560px] min-w-0 flex-[1_1_480px] flex-col gap-6">
          <h1
            id="hero-title"
            className="m-0 text-6xl leading-[0.95] font-bold tracking-[-0.05em] text-balance sm:text-8xl sm:leading-[0.92]"
          >
            Upgrades shouldn&apos;t wobble.
          </h1>
          <p className="m-0 max-w-[520px] text-xl leading-[1.5] font-medium text-pretty">
            A shim is the little wedge that keeps the table level. Ours slides under your dependency upgrade, fixes the
            code that compiles but quietly changed, and hands you one tested pull request. Today that&apos;s AI SDK 6 to 7
            and Zod 3 to 4. The same pipeline is built for any API that changes under you.
          </p>
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <a href="#scan" className="btn">
              Run the free scan →
            </a>
            <a href={links.repo} className="btn btn-alt">
              View on GitHub
            </a>
          </div>
        </div>
        <Scene />
      </div>
    </section>
  );
}
