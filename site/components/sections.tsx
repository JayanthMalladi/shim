import { CopyButton } from "./copy-button";
import { Reveal } from "./reveal";
import { links, scanCommands } from "@/lib/site";
import { prList, proof, proofValue } from "@/lib/stats";

function SectionHead({ id, title, children }: { id: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <h2 id={id} className="m-0 text-4xl leading-none font-bold tracking-[-0.04em] text-balance sm:text-6xl">
        {title}
      </h2>
      {children && <p className="m-0 text-lg leading-[1.55] font-medium text-pretty">{children}</p>}
    </div>
  );
}

/** Every repo with a Shim PR, scrolling. The second copy only exists to make the loop seamless. */
export function PrMarquee() {
  const item = (dup: boolean) =>
    prList.map((p) => (
      <a
        key={`${dup ? "d" : "a"}${p.url}`}
        href={p.url}
        data-dup={dup ? "" : undefined}
        aria-hidden={dup || undefined}
        tabIndex={dup ? -1 : undefined}
        className="whitespace-nowrap text-page no-underline hover:underline"
      >
        {p.repo} <span aria-hidden="true">✦</span>
      </a>
    ));
  return (
    <section
      id="prs"
      aria-label={`${prList.length} public repos with a Shim upgrade PR`}
      className="overflow-hidden border-y-[3px] border-ink bg-ink py-6"
    >
      <div className="marquee font-mono text-lg leading-7 sm:text-xl">
        {item(false)}
        {item(true)}
      </div>
    </section>
  );
}

/** The agent at work. Pure CSS: a cursor walks three real v7 reads and rewrites each one. */
export function WatchSection() {
  const rows = [
    ["meter.record(result.usage)", "meter.record(result.finalStep.usage)"],
    ["history.push(...response.messages)", "history.push(...result.responseMessages)"],
    ["generateText({ model, messages })", "generateText({ model, messages, allowSystemInMessages: true })"],
  ];
  return (
    <section aria-labelledby="watch-title" id="watch" className="px-4 pt-24 sm:px-8">
      <Reveal className="mx-auto flex max-w-[1184px] flex-wrap items-center gap-12">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <h2 id="watch-title" className="m-0 text-4xl leading-none font-bold tracking-[-0.04em] sm:text-5xl">
            Watch the wedge work
          </h2>
          <p className="m-0 text-lg leading-[1.55] font-medium text-pretty">
            Shim&apos;s agent walks your code line by line, rewrites what v7 quietly changed, then reruns every check you
            already had.
          </p>
        </div>
        <div
          role="img"
          aria-label="Shim's agent rewrites three silent v7 bugs one line at a time, then typecheck, tests and the judge pass."
          className="card agent min-w-0 flex-[1_1_640px] font-mono"
        >
          <div className="flex flex-wrap justify-between gap-3 text-xs leading-5">
            <span>lib/agent.ts · ai@7</span>
            <span className="ag-status">
              <span className="ag-s1">● shim is fixing silent bugs</span>
              <span className="ag-s2">✓ tsc ✓ tests ✓ judge: PR ready</span>
            </span>
          </div>
          <div className="overflow-x-auto">
            <div className="ag-lines">
              <span className="ag-cur">shim ▸</span>
              {rows.map(([bad, good], i) => (
                <div key={bad} className={`ag-row r${i + 1}`}>
                  <span className={`ag-b b${i + 1}`}>{bad}</span>
                  <span className={`ag-g g${i + 1}`}>{good}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

const wobbles = [
  {
    tag: "usage",
    color: "bg-page",
    tilt: "-1.5deg",
    delay: "0s",
    t: "Your token meter overcounts",
    code: "meter.record(result.usage)",
    d: "On calls with several steps, v7 adds up every step. Shim switches to finalStep.usage.",
  },
  {
    tag: "history",
    color: "bg-mint",
    tilt: "1deg",
    delay: "-1.1s",
    t: "Chat history loses tool calls",
    code: "history.push(...response.messages)",
    d: "v7 keeps only the last step there. Shim uses responseMessages.",
  },
  {
    tag: "system",
    color: "bg-pink",
    tilt: "-1deg",
    delay: "-2.2s",
    t: "System prompts start throwing",
    code: "{ role: 'system', ... }",
    d: "v7 rejects them at runtime. Typecheck stays green. Shim opts you back in.",
  },
];

export function WobblesSection() {
  return (
    <section aria-labelledby="wobbles-title" id="wobbles" className="px-4 py-24 sm:px-8">
      <Reveal className="mx-auto flex max-w-[1184px] flex-col gap-12">
        <SectionHead id="wobbles-title" title="Three wobbles the codemod doesn't feel">
          Each one compiles and keeps your tests green, so neither tsc nor the codemod notices.
        </SectionHead>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-8">
          {wobbles.map((w) => (
            <div
              key={w.tag}
              className="card rock"
              style={{ "--t": w.tilt, animationDelay: w.delay } as React.CSSProperties}
            >
              <span className={`tag ${w.color}`}>{w.tag}</span>
              <span className="text-2xl leading-8 font-bold tracking-[-0.02em]">{w.t}</span>
              <code className="overflow-x-auto rounded-lg bg-cream p-3 font-mono text-sm leading-5 whitespace-pre">
                {w.code}
              </code>
              <span className="text-base leading-6">{w.d}</span>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

const steps = [
  { n: "1", t: "Check", bg: "bg-paper", d: "Install with scripts off. Run your typecheck and tests. Only what passes now counts later." },
  { n: "2", t: "Bump", bg: "bg-mint", d: "Move to ai@7 and run the official codemod for the renames." },
  { n: "3", t: "Fix", bg: "bg-pink", d: "Rewrite every read whose meaning changed. Rules first, an agent only where a rule cannot." },
  { n: "4", t: "Prove", bg: "bg-wedge", d: "Rerun every check, then a separate judge reads the diff. Any regression means an issue, not a PR." },
];

export function HowSection() {
  return (
    <section aria-labelledby="how-title" id="how" className="px-4 py-24 sm:px-8">
      <Reveal className="mx-auto flex max-w-[1184px] flex-col gap-12">
        <SectionHead id="how-title" title="How it works">
          {proof.headline} candidates passed every test and never shipped, because the judge caught them.
        </SectionHead>
        <ol className="m-0 grid list-none grid-cols-1 gap-8 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <li key={s.n} className={`card ${s.bg}`}>
              <span className="grid size-10 place-items-center rounded-full border-[3px] border-ink bg-paper font-bold">
                {s.n}
              </span>
              <span className="text-2xl leading-8 font-bold">{s.t}</span>
              <span className="text-base leading-6">{s.d}</span>
            </li>
          ))}
        </ol>
        <p className="m-0 text-sm leading-5 font-medium">
          Agent cost on our runs: {proofValue("agent cost")?.replace("–", " to ") ?? "n/a"} per repo.
        </p>
      </Reveal>
    </section>
  );
}

export function ScanSection() {
  return (
    <section aria-labelledby="scan-title" id="scan" className="px-4 py-24 sm:px-8">
      <Reveal className="mx-auto flex max-w-[880px] flex-col gap-8">
        <SectionHead id="scan-title" title="Or scan it yourself, tonight">
          The scan runs locally, writes nothing, and lists each silent change with file, line and fix. Node 22 or later.
        </SectionHead>
        <div className="card flex-row items-start justify-between gap-4 bg-ink text-page">
          <pre className="m-0 min-w-0 overflow-x-auto font-mono text-sm leading-6">
            {scanCommands.map((c) => (
              <span key={c} className="block">
                <span aria-hidden="true" className="text-wedge select-none">
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
    a: "You get a short issue with the file and line instead of a PR. Shim never opens a PR that regresses a check.",
  },
  {
    q: "Does it run my install scripts or see my keys?",
    a: "No. Installs always use --ignore-scripts, and commands in your repo run without API keys.",
  },
  {
    q: "What runs the fix agent, and do I need an API key?",
    a: "The scan needs no model or key. The fix agent runs on a model you provide: your own Claude login or API key, any Anthropic-compatible provider, or open-source models.",
  },
  {
    q: "Can I run it myself?",
    a: "Yes. The code is public on GitHub, and the scan runs with “npx getshim scan .” on Node 22 or later.",
  },
];

export function FaqSection() {
  return (
    <section aria-labelledby="faq-title" id="faq" className="px-4 py-24 sm:px-8">
      <Reveal className="mx-auto flex max-w-[760px] flex-col gap-8">
        <SectionHead id="faq-title" title="Questions" />
        <div className="flex flex-col gap-4">
          {faq.map((f) => (
            <details key={f.q} className="group rounded-2xl border-[3px] border-ink bg-paper px-6 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg leading-7 font-bold">
                {f.q}
                <span
                  aria-hidden="true"
                  className="text-2xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="m-0 pt-2 text-base leading-6">{f.a}</p>
            </details>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

const vercelFix = "https://github.com/vercel/ai/pull/24438";

/** The strongest proof, right under the hero. Text only: a factual statement, not an endorsement. */
export function ProofStrip() {
  return (
    <section aria-label="Merged upstream" className="px-4 pb-24 sm:px-8">
      <div className="mx-auto flex max-w-[1184px] flex-wrap items-center justify-between gap-6 rounded-[32px] border-[3px] border-ink bg-paper p-6 shadow-[8px_8px_0_#111] sm:p-8">
        <div className="flex min-w-0 flex-[1_1_480px] flex-col items-start gap-3">
          <span className="tag bg-mint">Merged upstream</span>
          <p className="m-0 text-2xl leading-8 font-bold tracking-[-0.02em] text-pretty">
            We found a bug in the official AI SDK 7 codemod. Vercel merged the fix and credited our report.
          </p>
        </div>
        <a href={vercelFix} className="btn btn-sm">
          See vercel/ai#24438 →
        </a>
      </div>
    </section>
  );
}

const changelog: { label: string; bg: string; items: React.ReactNode[] }[] = [
  {
    label: "Shipped",
    bg: "bg-mint",
    items: [
      `${prList.length} AI SDK 7 upgrade PRs opened on public repos`,
      `A separate judge that has blocked ${proof.headline} green but wrong diffs`,
      "A guard for the official codemod when it renames your own exports",
      <span key="vercel-fix">
        Found a bug in the official AI SDK 7 codemod; Vercel merged the fix and credited our report (
        <a href={vercelFix} className="underline underline-offset-4">
          vercel/ai#24438
        </a>
        )
      </span>,
      "Per test baseline: only checks green before the upgrade count after it",
      "Runs on macOS, Linux and Windows",
    ],
  },
  {
    label: "Building now",
    bg: "bg-paper",
    items: [
      "Evolving the fix agent: variants compete on real repos and the winner becomes the default",
      "Short issue drafts with file and line when a PR would regress a check",
    ],
  },
  {
    label: "Next",
    bg: "bg-pink",
    items: [
      "pnpm catalog: support, which blocked four repos so far",
      "Scan repos that already moved to v7 for the silent bugs they kept",
      "Next migrations after AI SDK 7: other SDKs with silent breaking changes",
    ],
  },
];

export function ChangelogSection() {
  return (
    <section aria-labelledby="changelog-title" id="changelog" className="px-4 py-24 sm:px-8">
      <Reveal className="mx-auto flex max-w-[1184px] flex-col gap-12">
        <SectionHead id="changelog-title" title="Built in the open">
          Shim is in active development. Here is what works today and what ships next.
        </SectionHead>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {changelog.map((c) => (
            <div key={c.label} className={`card ${c.bg}`}>
              <span className="tag bg-paper">{c.label}</span>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {c.items.map((i, n) => (
                  <li key={n} className="flex gap-3 text-base leading-6 font-medium">
                    <span aria-hidden="true" className="font-bold">
                      ▸
                    </span>
                    {i}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

export function FinalCta() {
  return (
    <section aria-labelledby="start-title" id="start" className="px-4 pt-12 pb-24 sm:px-8">
      <div className="mx-auto flex max-w-[1184px] flex-wrap items-center justify-between gap-8 rounded-[32px] border-[3px] border-ink bg-wedge p-8 shadow-[12px_12px_0_#111] sm:p-12">
        <div className="flex flex-[1_1_420px] flex-col gap-3">
          <h2 id="start-title" className="m-0 text-4xl leading-none font-bold tracking-[-0.04em] sm:text-5xl">
            Follow the build.
          </h2>
          <p className="m-0 text-lg leading-7 font-medium">
            New features land in the repo first. Run the scan on your app tonight, or watch what ships next.
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          <a href={links.repo} className="btn shadow-[6px_6px_0_#fff] hover:shadow-[8px_8px_0_#fff]">
            Star on GitHub →
          </a>
          <a href="#scan" className="btn btn-alt">
            Run the scan
          </a>
        </div>
      </div>
    </section>
  );
}
