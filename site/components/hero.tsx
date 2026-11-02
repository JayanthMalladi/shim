import { CheckIcon, PullRequestIcon } from "./icons";
import { SiteLink } from "./site-link";
import { links } from "@/lib/site";
import { prs, proof, proofValue } from "@/lib/stats";

const fixes = [
  { text: "result.finalStep.usage keeps the v6 token count", at: "lib/agent.ts:24" },
  { text: "responseMessages keeps every step in stored history", at: "lib/chat.ts:51" },
  { text: "allowSystemInMessages keeps the system prompt working", at: "route.ts:12" },
];

export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-title" className="px-4 pt-24 pb-16 md:pt-32">
      <div className="mx-auto flex max-w-[680px] flex-col items-center gap-6 text-center">
        <a
          href="#prs"
          className="caption-4 inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-ink-2 no-underline transition-colors duration-300 hover:border-slate-300"
        >
          <span aria-hidden="true" className="size-2 rounded-full bg-emerald-500" />
          {prs.open} upgrade PRs open on public repos
        </a>
        <h1 id="hero-title" className="ink-gradient m-0 text-4xl leading-10 font-semibold tracking-[-0.035em] text-balance sm:text-6xl sm:leading-none">
          Go to sleep on ai@6.
          <br />
          Wake up to a tested PR.
        </h1>
        <p className="lede m-0 max-w-[600px] text-body">
          Shim does the whole AI SDK 7 upgrade for you: the bump, the codemod, the fixes for code that still compiles
          but now returns different data, and a full run of your own tests. You get one pull request to review.
        </p>
        <div className="flex flex-col items-center gap-3">
          <SiteLink href={links.booking} className="btn btn-primary">
            Join the pilot
          </SiteLink>
          <a href="#scan" className="body-6 text-muted underline-offset-4 hover:text-ink hover:underline">
            or run the free scan yourself
          </a>
        </div>
      </div>

      <div className="relative mx-auto mt-16 max-w-[760px]">
        <div
          aria-hidden="true"
          className="absolute inset-x-8 top-0 h-24 -translate-y-12 scale-[0.94] rounded-2xl border border-line bg-surface"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-4 top-0 h-24 -translate-y-6 scale-[0.97] rounded-2xl border border-line bg-surface"
        />
        <article
          aria-labelledby="pr-card-title"
          className="relative overflow-hidden rounded-2xl border border-line bg-white text-left shadow-[0_24px_48px_rgba(15,23,42,0.08)]"
        >
          <div className="flex flex-col gap-3 border-b border-line p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip bg-ok-wash text-ok-ink">
                <PullRequestIcon size={12} />
                open
              </span>
              <span className="caption-5 font-mono text-muted">shim/ai-sdk-7 → main · example</span>
            </div>
            <h2 id="pr-card-title" className="heading-5 m-0">
              Upgrade to AI SDK 7
            </h2>
            <p className="body-6 m-0 text-body">
              Moves the project from AI SDK 6 to 7 and keeps its current behavior. The codemod alone is not enough
              here: three reads change meaning without a type error.
            </p>
          </div>
          <div className="flex flex-col gap-4 p-6">
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {fixes.map((f) => (
                <li key={f.at} className="body-6 flex items-start gap-3">
                  <CheckIcon size={16} className="mt-0.5 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">{f.text}</span>
                  <span className="caption-5 hidden font-mono whitespace-nowrap text-muted sm:inline">{f.at}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <span className="chip bg-accent-wash text-accent-ink">typecheck pass → pass</span>
              <span className="chip bg-accent-wash text-accent-ink">test pass → pass</span>
              <span className="chip bg-accent-wash text-accent-ink">judge approved</span>
              <span className="chip bg-sunken text-ink-2">3 files · +3 −2</span>
            </div>
          </div>
        </article>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat value={proof.headline} label="green but wrong diffs stopped by the judge" tone="warn" />
          <Stat value={String(prs.total)} label="upgrade PRs opened upstream" />
          <Stat value={proofValue("pr-ready, night one")?.split("·")[1]?.trim() ?? "48%"} label="of attempted repos PR ready, night one" />
        </div>
      </div>
    </section>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: "warn" }) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-2xl border p-4 text-left ${tone === "warn" ? "border-amber-200 bg-warn-wash" : "border-line bg-surface"}`}
    >
      <span className={`heading-3 font-mono tabular-nums ${tone === "warn" ? "text-warn-ink" : "text-ink"}`}>
        {value}
      </span>
      <span className="body-6 text-body">{label}</span>
    </div>
  );
}
