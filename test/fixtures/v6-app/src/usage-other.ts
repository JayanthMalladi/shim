// No `ai` import: these flat reads are on the repo's own object and are not AI SDK usage. Not flagged.
declare const stats: any;

export function ownStats() {
  return stats.usage.reasoningTokens;
}
