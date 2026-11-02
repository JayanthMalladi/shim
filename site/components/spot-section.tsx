"use client";

import { useState } from "react";

const code = `const result = await generateText({
  model, tools,
  stopWhen: stepCountIs(5),
});
meter.record(result.usage);`;

/** C from round two: the same line on v6 and v7, and a button that shows what changed. */
export function SpotSection() {
  const [shown, setShown] = useState(false);
  const panes = [
    { ver: "ai@6", answer: "the last step", changed: false },
    { ver: "ai@7", answer: "all five steps, added up", changed: true },
  ];
  return (
    <section id="why" aria-labelledby="why-title" className="px-4 py-24">
      <div className="mx-auto flex max-w-[1040px] flex-col items-center gap-10">
        <div className="flex max-w-[680px] flex-col items-center gap-4 text-center">
          <h2 id="why-title" className="heading-3 m-0">
            These two lines are identical.
            <br />
            Their numbers aren&apos;t.
          </h2>
          <p className="body-3 m-0 text-body">
            Same code, same types, same green tests. The official codemod and tsc both pass it. Can you spot the bug?
          </p>
        </div>

        <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
          {panes.map((p) => {
            const lit = shown && p.changed;
            return (
              <figure
                key={p.ver}
                className={`m-0 flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-white transition-colors duration-500 ${lit ? "border-amber-300" : "border-line"}`}
              >
                <figcaption className="caption-5 flex justify-between border-b border-line px-6 py-4 font-mono text-muted">
                  <span className="font-medium text-ink">{p.ver}</span>
                  <span>typecheck pass · test pass</span>
                </figcaption>
                <pre className="m-0 overflow-x-auto px-6 py-6 font-mono text-sm leading-6 text-ink">{code}</pre>
                <div
                  className={`mx-6 mb-6 flex flex-col gap-1 rounded-xl p-4 transition-colors duration-500 ${lit ? "bg-warn-wash" : "bg-surface"}`}
                >
                  <span className="caption-5 font-mono text-muted">result.usage holds</span>
                  <span className={`heading-5 ${lit ? "text-warn-ink" : "text-ink"}`} aria-live="polite">
                    {shown ? p.answer : "?"}
                  </span>
                </div>
              </figure>
            );
          })}
        </div>

        <div className="flex flex-col items-center gap-4">
          <button type="button" className="btn btn-ghost" onClick={() => setShown((v) => !v)} aria-pressed={shown}>
            {shown ? "Hide the answer" : "Show the difference"}
          </button>
          {shown && (
            <p className="body-3 m-0 max-w-[600px] text-center text-body">
              On v7, <code className="font-mono text-ink">usage</code> on a call with several steps adds up every
              step. Shim rewrites it to <code className="font-mono text-ink">result.finalStep.usage</code> so your
              meter reads what it read before. Calls with one step are left alone.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
