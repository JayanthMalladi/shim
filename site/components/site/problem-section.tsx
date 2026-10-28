import { CodeBlock, CodeBlockCopyButton } from "@/components/ai-elements/code-block";
import { Eyebrow, Lede, SectionTitle, TimelineSection } from "./timeline-section";

const cases = [
  {
    file: "lib/agent.ts",
    rule: "multi-step-result",
    code: `const result = await generateText({
  model, tools,
  stopWhen: stepCountIs(5),
  prompt,
});
meter.record(result.usage);`,
    highlight: [6],
    effect: "v7: sums all five steps instead of the last one.",
    fix: "→ result.finalStep.usage",
  },
  {
    file: "lib/chat.ts",
    rule: "response-messages",
    code: `const result = await generateText({
  model, tools, messages,
  stopWhen: stepCountIs(5),
});
history.push(...result.response.messages);`,
    highlight: [5],
    effect: "v7: only the final step's messages. Tool calls vanish from history.",
    fix: "→ result.responseMessages",
  },
  {
    file: "app/api/chat/route.ts",
    rule: "system-in-messages",
    code: `const result = streamText({
  model,
  messages: [
    { role: 'system', content: rules },
    ...messages,
  ],
});`,
    highlight: [4],
    effect: "v7: rejected at runtime. Typecheck stays green.",
    fix: "→ allowSystemInMessages: true",
  },
];

export function ProblemSection() {
  return (
    <TimelineSection id="problem" labelledBy="problem-title">
      <Eyebrow>01 · why the codemod isn&apos;t enough</Eyebrow>
      <SectionTitle id="problem-title" className="max-w-[20ch]">
        Same code. Different data.
      </SectionTitle>
      <Lede className="max-w-[60ch]">
        These all compile on AI SDK 7. Your tests only notice if they assert the exact value, and mocked single-step
        tests usually don&apos;t.
      </Lede>

      <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-4">
        {cases.map((c) => (
          <figure
            key={c.file}
            className="m-0 flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-panel"
          >
            <CodeBlock code={c.code} filename={c.file} label={c.rule} highlight={c.highlight} className="flex-1">
              <CodeBlockCopyButton aria-label={`Copy ${c.file} snippet`} className="mr-1 size-8" />
            </CodeBlock>
            <figcaption className="flex flex-col gap-1 border-t border-line px-3.5 py-3 text-[13px] text-fg-3">
              <span>{c.effect}</span>
              <span className="font-mono text-blue">{c.fix}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </TimelineSection>
  );
}
