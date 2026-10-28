import { generateText, streamText, type GenerateTextResult, type StreamTextResult } from 'ai';

declare const model: any;
declare const tools: any;
declare function stepCountIs(n: number): any;
declare function bill(n: number): void;

// The producing call is in one place, the reads in another.
export function run(prompt: string) {
  return generateText({ model, tools, prompt, stopWhen: stepCountIs(5) });
}

export function summarize(result: Awaited<ReturnType<typeof generateText>>) {
  const history = result.response.messages;
  bill(result.usage.totalTokens);
  return { history, warnings: result.warnings, text: result.text };
}

export function viaResultType(result: GenerateTextResult<any, any, any>, other?: StreamTextResult<any, any>) {
  const { toolCalls, text } = result;
  return { toolCalls, text, sources: other?.sources };
}

export function textOnly(result: Awaited<ReturnType<typeof generateText>>) {
  // Only a property whose meaning didn't change. Must not be flagged.
  return result.text;
}

interface Totals {
  usage: { tokens: number };
}

export function unrelated(totals: Totals, billing: { toolCalls: number }) {
  // The repo's own types. Must not be flagged.
  return totals.usage.tokens + billing.toolCalls;
}

export class Recorder {
  private last?: Awaited<ReturnType<typeof streamText>>;
  keep(last: Awaited<ReturnType<typeof streamText>>) {
    this.last = last;
  }
  files() {
    return this.last?.files;
  }
}

export function tracked() {
  // Initialised straight from the call, so the multi-step tracker owns it: reported once, as multi-step-result.
  const result: StreamTextResult<any, any> = streamText({ model, tools, stopWhen: stepCountIs(3) });
  return result.toolCalls;
}
