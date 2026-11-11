import { generateText, convertToModelMessages } from 'ai';

declare const model: any;
declare const history: any[];

// A2: a top-level `system` option means the caller put the system prompt where it belongs. An inline
// `role: "system"` message or a `convertToModelMessages` result (UIMessage allows the `system` role)
// is still flagged; a `messages`/`prompt` built elsewhere is not, because someone who already uses
// `system` almost never also hides a system message in the list.
export async function systemWithInlineSystem() {
  // Inline system message: flagged even though `system` is also set.
  return generateText({ model, system: 's', messages: [{ role: 'system', content: 'x' }] });
}

export async function systemWithUnknownPrompt(userText: any) {
  // `system` set + `prompt` built elsewhere (not provably a string): not flagged.
  return generateText({ model, system: 's', prompt: userText });
}

export async function systemWithVariableMessages() {
  // `system` set + `messages` built elsewhere: not flagged.
  return generateText({ model, system: 's', messages: history });
}

export async function noSystemVariableMessages() {
  // No `system` option, `messages` built elsewhere: still flagged.
  return generateText({ model, messages: history });
}

export async function systemWithConvertedMessages(uiMessages: any[]) {
  // `system` set but the messages come from `convertToModelMessages`, which can carry a `system`
  // role: not treated as safe, so it is flagged — downgraded to the "maybe" rule (silent, agent).
  return generateText({ model, system: 's', messages: convertToModelMessages(uiMessages) });
}
