/**
 * Every outbound link and launch placeholder lives here.
 * Values wrapped in [brackets] are unresolved placeholders: the UI marks them
 * with a dashed outline until they are replaced with real values.
 */
export const links = {
  // Stand-in until a real waitlist form exists. Points at the repo; the CTA is
  // labelled "Star on GitHub" so it says what it does, not a promise of a form.
  waitlist: "https://github.com/JayanthMalladi/shim",
  // GitHub App not published yet — the CTA is labelled "View source" and points
  // at the repo.
  githubApp: "https://github.com/JayanthMalladi/shim",
  repo: "https://github.com/JayanthMalladi/shim",
  firstPr: "https://github.com/requestyai/ai-sdk-requesty/pull/66",
} as const;

export const placeholders = {
  // Free during the pilot is the honest current state.
  price: "Free during pilot",
  founder: "Jayanth Malladi",
} as const;

// Shim isn't on npm yet (the npm name "shim" belongs to an unrelated polyfill),
// so the commands run it from a clone.
export const scanCommand = "npx tsx src/cli.ts scan ../your-repo";
export const migrateCommand = "npx tsx src/cli.ts migrate ../your-repo --agent";
export const setupCommand = "git clone https://github.com/JayanthMalladi/shim && cd shim && npm install";

export function isPlaceholder(value: string): boolean {
  return /^\[.+\]$/.test(value.trim());
}
