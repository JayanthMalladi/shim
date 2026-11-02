import { CheckIcon } from "./icons";
import { CopyButton } from "./copy-button";
import { Reveal } from "./reveal";
import { SiteLink } from "./site-link";
import { links, scanCommands } from "@/lib/site";
import { prList, proof, proofValue } from "@/lib/stats";

function SectionHead({ id, title, children }: { id: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex max-w-[680px] flex-col gap-4">
      <h2 id={id} className="heading-3 m-0">
        {title}
      </h2>
      {children && <p className="body-3 m-0 text-body">{children}</p>}
    </div>
  );
}

const steps = [
  { n: "01", t: "Baseline", d: "Install with scripts off. Run your typecheck and tests. Only gates green here count later." },
  { n: "02", t: "Upgrade", d: "Bump to ai@7 and run the official codemod for the renames." },
  { n: "03", t: "Fix", d: "Rewrite every read whose meaning changed. Rules first, an agent only where a rule cannot." },
  { n: "04", t: "Prove", d: "Rerun every gate, then a separate judge reads the diff. Any regression means an issue, not a PR." },
];

export function HowSection() {
  return (
    <section aria-labelledby="how-title" id="how" className="px-4 py-24">
      <Reveal className="mx-auto flex max-w-[1040px] flex-col gap-10">
        <SectionHead id="how-title" title="What happens while you sleep">
          The slow part runs unattended. You only see the result, and only if it passed.
        </SectionHead>
        <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <li key={s.n} className="flex flex-col gap-2 rounded-2xl border border-line p-6">
              <span className="caption-4 font-mono text-accent">{s.n}</span>
              <span className="title-2">{s.t}</span>
              <span className="body-6 text-body">{s.d}</span>
            </li>
          ))}
        </ol>
        <p className="caption-5 m-0 text-muted">
          Agent cost on our runs: {proofValue("agent cost")?.replace("–", " to ") ?? "n/a"} per repo.
        </p>
      </Reveal>
    </section>
  );
}

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const stateChip: Record<string, string> = {
  open: "bg-ok-wash text-ok-ink",
  merged: "bg-accent-wash text-accent-ink",
  closed: "bg-sunken text-ink-2",
};

export function PrsSection() {
  return (
    <section aria-labelledby="prs-title" id="prs" className="px-4 py-24">
      <Reveal className="mx-auto flex max-w-[1040px] flex-col gap-10">
        <SectionHead id="prs-title" title={<>Already open on {prList.length} public repos</>}>
          Every Shim PR on an open source project, refreshed from GitHub every six hours. {proof.headline} more
          candidates passed every test and never shipped, because the judge caught them.
        </SectionHead>
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {prList.map((p) => {
            const [owner, name] = p.repo.split("/");
            return (
              <li key={p.url}>
                <a
                  href={p.url}
                  className="lift flex h-full flex-col gap-4 rounded-2xl border border-line bg-white p-4 no-underline hover:border-slate-300"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="caption-5 font-mono text-muted">
                      #{p.url.split("/").pop()} · {fmtDate(p.openedAt)}
                    </span>
                    <span className={`chip ${stateChip[p.state]}`}>{p.state}</span>
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="caption-5 truncate text-muted">{owner}</span>
                    <span className="title-3 truncate">{name}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </Reveal>
    </section>
  );
}

const plans = [
  {
    name: "Free scan",
    desc: "See every silent v7 change in your repo before you bump.",
    price: "$0",
    cycle: "always",
    items: ["Runs on your machine and only reads", "File and line for every finding", "What each one does at runtime", "The suggested fix"],
    cta: "Run the scan",
    href: "#scan",
    primary: false,
  },
  {
    name: "Pilot",
    desc: "We run the full upgrade and send you one tested pull request.",
    price: "Free",
    cycle: "during the pilot",
    items: ["Bump, codemod and silent fixes", "Your typecheck and tests rerun", "An independent judge on every diff", "An issue instead if anything regresses"],
    cta: "Join the pilot",
    href: links.booking,
    primary: true,
  },
];

export function PricingSection() {
  return (
    <section aria-labelledby="pricing-title" id="pricing" className="px-4 py-24">
      <Reveal className="mx-auto flex max-w-[880px] flex-col items-center gap-10">
        <h2 id="pricing-title" className="heading-3 m-0 text-center">
          Pricing
        </h2>
        <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
          {plans.map((p) => (
            <div
              key={p.name}
              className={`flex flex-col gap-4 rounded-3xl border bg-white p-8 ${p.primary ? "border-accent" : "border-line"}`}
            >
              <span className="title-2">{p.name}</span>
              <span className="body-6 text-body">{p.desc}</span>
              <span className="flex items-baseline gap-2 py-2">
                <span className="heading-3">{p.price}</span>
                <span className="body-6 text-muted">{p.cycle}</span>
              </span>
              <ul className="m-0 flex list-none flex-col gap-3 border-t border-line-soft p-0 pt-4">
                {p.items.map((i) => (
                  <li key={i} className="body-6 flex gap-2">
                    <CheckIcon size={16} className="mt-0.5 shrink-0 text-accent" />
                    {i}
                  </li>
                ))}
              </ul>
              <SiteLink href={p.href} className={`btn mt-2 ${p.primary ? "btn-primary" : "btn-ghost"}`}>
                {p.cta}
              </SiteLink>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

export function ScanSection() {
  return (
    <section aria-labelledby="scan-title" id="scan" className="px-4 py-24">
      <Reveal className="mx-auto flex max-w-[880px] flex-col gap-6">
        <SectionHead id="scan-title" title="Or scan it yourself, tonight">
          The scan runs locally, writes nothing, and lists each silent change with file, line and fix. Node 22 or
          later.
        </SectionHead>
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-line bg-surface p-4">
          <pre className="m-0 min-w-0 overflow-x-auto font-mono text-sm leading-6 text-ink">
            {scanCommands.map((c) => (
              <span key={c} className="block">
                <span aria-hidden="true" className="text-muted select-none">
                  ${" "}
                </span>
                {c}
              </span>
            ))}
          </pre>
          <CopyButton value={scanCommands.join("\n")} label="Copy scan commands" />
        </div>
      </Reveal>
    </section>
  );
}

const faq = [
  {
    q: "Why is the official codemod not enough?",
    a: "It handles renames. The v7 changes that matter still compile, so neither the codemod nor tsc flags them.",
  },
  {
    q: "Will it change how my app behaves?",
    a: "No. Every fix keeps the value your code read on v6, for example finalStep.usage in place of usage.",
  },
  {
    q: "What if my tests fail after the upgrade?",
    a: "You get a short issue with the file and line instead of a PR. Shim never opens a PR that regresses a gate.",
  },
  {
    q: "Does it run my install scripts or see my keys?",
    a: "No. Installs always use --ignore-scripts, and commands in your repo run without API keys.",
  },
  {
    q: "Are calls with one step touched?",
    a: "No. The v7 default is still one step, so those calls behave the same and are left alone.",
  },
  {
    q: "What does the pilot cost?",
    a: "Nothing. The scan stays free after the pilot too.",
  },
];

export function FaqSection() {
  return (
    <section aria-labelledby="faq-title" id="faq" className="px-4 py-24">
      <Reveal className="mx-auto flex max-w-[680px] flex-col gap-6">
        <h2 id="faq-title" className="heading-3 m-0">
          Questions
        </h2>
        <div>
          {faq.map((f) => (
            <details key={f.q} className="group border-t border-line py-4 last:border-b">
              <summary className="title-3 flex cursor-pointer list-none items-center justify-between gap-4">
                {f.q}
                <span
                  aria-hidden="true"
                  className="text-muted transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="body-6 m-0 pt-2 text-body">{f.a}</p>
            </details>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

export function FinalCta() {
  return (
    <section aria-labelledby="start-title" id="start" className="px-4 pt-24 pb-24">
      <div className="mx-auto flex max-w-[680px] flex-col items-center gap-6 text-center">
        <h2 id="start-title" className="ink-gradient m-0 text-5xl leading-none font-semibold tracking-[-0.035em] text-balance">
          Go to sleep on ai@6.
          <br />
          Wake up to a tested PR.
        </h2>
        <SiteLink href={links.booking} className="btn btn-primary">
          Join the pilot
        </SiteLink>
        <span className="caption-5 text-muted">No PR unless every check that passed before still passes.</span>
      </div>
    </section>
  );
}
