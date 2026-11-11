import { generateText } from 'ai';

declare const model: any;

// AI SDK 7 removed the flat `usage.reasoningTokens` / `usage.cachedInputTokens` fields; both read as
// `undefined` at runtime. They now live under `outputTokenDetails` / `inputTokenDetails`.
export async function flatReasoning() {
  const result = await generateText({ model, prompt: 'hi' });
  return result.usage.reasoningTokens;
}

export async function flatCached() {
  const result = await generateText({ model, prompt: 'hi' });
  return (await result.usage).cachedInputTokens;
}

export async function flatOptional() {
  const result = await generateText({ model, prompt: 'hi' });
  return result.usage?.reasoningTokens;
}

export function endCallbackUsage(event: any) {
  return event.usage.reasoningTokens;
}

export function stepUsage(step: any) {
  return step.usage.cachedInputTokens;
}

// The nested fields already exist in v6, so reading them is correct on both versions. Not flagged.
export async function nestedRead() {
  const result = await generateText({ model, prompt: 'hi' });
  return result.usage.outputTokenDetails.reasoningTokens;
}

// OpenAI's flat snake_case shape: a different field name, not an AI SDK read. Not flagged.
export function openaiShape(completion: any) {
  return completion.usage.reasoning_tokens;
}
