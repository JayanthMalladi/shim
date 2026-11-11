import { tool, type ToolExecutionOptions } from 'ai';

declare const db: { query: (s: string) => unknown };
declare const msgs: any[];

export const search = tool({
  inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
  execute: async (input: { q: string }) => db.query(input.q),
});

// An options literal passed to a tool's `.execute(...)` with no `context` -> flagged.
export function callNoContext() {
  return search.execute({ q: 'hi' }, { toolCallId: 'call_1', messages: [] });
}

// The same call with a `context` field: already correct, must NOT be flagged.
export function callWithContext() {
  return search.execute({ q: 'hi' }, { toolCallId: 'call_1', messages: [], context: { db } });
}

// A variable explicitly typed ToolExecutionOptions, missing `context` -> flagged.
const opts: ToolExecutionOptions<any> = { toolCallId: 'call_2', messages: msgs };
export function typedNoContext() {
  return opts;
}

// ...and one that supplies `context` -> not flagged.
const ok: ToolExecutionOptions<any> = { toolCallId: 'call_3', messages: msgs, context: { db } };
export function typedWithContext() {
  return ok;
}

// A virtual-CLI `.execute` literal that has `toolCallId` but no `messages` -> not ai's options; must NOT flag.
declare const host: any;
export function virtualCliRun() {
  host.run.execute('argv', { sessionId: 's', toolCallId: 'call_4', signal: undefined });
}

// A custom tool `.execute` with `toolCallId` + an unrelated field, no `messages` -> must NOT flag.
declare const t: any;
export function customToolExecute() {
  t.execute('i', { toolCallId: 'call_5', approved: true });
}
