import { generateText, streamText, stepCountIs, registerTelemetry as _unused } from 'ai';
import * as ai from 'ai';

declare const model: any;
declare const tools: any;
declare function bill(n: number): void;

export async function multiStep() {
  const result = await generateText({
    model,
    tools,
    stopWhen: stepCountIs(5),
    onFinish(event) {
      bill(event.usage.totalTokens);
    },
  });
  bill(result.usage.totalTokens);
  const calls = result.toolCalls;
  const history = result.response.messages;
  const total = result.totalUsage;
  return { calls, history, total };
}

export async function singleStep() {
  // Single step: usage means the same thing in v6 and v7. Must not be flagged.
  const result = await generateText({ model, prompt: 'hi' });
  return result.usage;
}

export async function destructured() {
  const { usage, text } = await ai.generateText({ model, stopWhen: stepCountIs(3) });
  return { usage, text };
}

export function streaming() {
  const result = streamText({
    model,
    stopWhen: stepCountIs(2),
    experimental_telemetry: { isEnabled: true },
    messages: [
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content: 'Hello' },
    ],
  });
  return result.toolCalls;
}
