import { generateText, generateObject, streamText, ToolLoopAgent } from 'ai';

declare const model: any;
declare const tools: any;
declare const schema: any;
declare const history: any[];
declare function buildMessages(q: string): any[];
declare function sys(content: string): { role: 'system'; content: string };

export async function variableMessages() {
  return generateText({ model, messages: history });
}

export async function helperMessages(q: string) {
  return generateText({
    model,
    messages: buildMessages(q),
  });
}

export async function helperElement(q: string) {
  return streamText({ model, messages: [sys('Be terse.'), { role: 'user', content: q }] });
}

export async function objectCall(q: string) {
  return generateObject({ model, schema, messages: history, temperature: 0 });
}

export async function plainMessages(q: string) {
  // Literal user/assistant messages and string prompts can't hold a system message. Must not be flagged.
  await generateText({ model, messages: [{ role: 'user', content: q }, { role: 'assistant', content: 'ok' }] });
  await generateText({ model, prompt: q });
  return generateText({ model, prompt: `Summarize ${q}` });
}

export async function alreadyAllowed() {
  // Already set: must not be touched.
  return generateText({ model, messages: history, allowSystemInMessages: true });
}

export async function viaSpread(extra: { messages: any[] }) {
  return generateText({ model, ...extra });
}

export function agents(q: string) {
  const tracked = new ToolLoopAgent({ model, tools });
  const plain = new ToolLoopAgent({ model, tools });
  const done = tracked.generate({ messages: history });
  // Only string prompts and literal user messages: must not be flagged.
  plain.generate({ prompt: q });
  plain.stream({ messages: [{ role: 'user', content: q }] });
  return done;
}

export const shared = new ToolLoopAgent({
  model,
  tools,
});
