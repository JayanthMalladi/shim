Title: AI SDK 7: multi-step generateText still reads result.warnings instead of the last step

Found while upgrading to AI SDK 7.

src/ai/AIProvider.ts:989 - a multi-step generateText call (stopWhen set) reads
result.warnings. In AI SDK 7, usage, toolCalls, toolResults, content, text and
warnings span all steps instead of just the last, so that read now aggregates
every step. tsc and the test suite still pass because the return shape is
unchanged, and the official codemod only renames imports and updates versions -
it does not rewrite which result field is read - so the change is silent:
billing, logging and UI read different data at runtime.

Fix: read result.finalStep.warnings, which keeps the old last-step meaning.

Happy to send a PR.
