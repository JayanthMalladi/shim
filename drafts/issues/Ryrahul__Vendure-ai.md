Title: AI SDK 7: tool execute call is missing the now-required context

Found while upgrading to AI SDK 7.

packages/ai-chat-plugin/src/services/admin-ai-chat.service.ts:551 - the tool
execute call is missing the context option. AI SDK 7 made context a required
field on tool execution options, but it is not a public type tsc checks at
the call site, and the official codemod only renames imports and updates
versions - it does not add call-site fields - so tsc and the test suite still
pass. At runtime the tool executes without the context the SDK now expects.

Fix: pass context to the execute call - a value matching the tool's
contextSchema, or {} when the tool defines none.

Happy to send a PR.
