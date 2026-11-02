/**
 * Every outbound link and launch placeholder lives here.
 * Values wrapped in [brackets] are unresolved placeholders: the UI marks them
 * with a dashed outline until they are replaced with real values.
 */
export const links = {
  repo: "https://github.com/JayanthMalladi/shim",
} as const;

export const founder = "Jayanth Malladi";

/**
 * Shim is not on npm (the `shim` package there is unrelated), so the scan runs
 * from a clone of the repo.
 */
export const scanCommands = [
  "git clone https://github.com/JayanthMalladi/shim",
  "cd shim && npm install",
  "npx tsx src/cli.ts scan ../your-app",
] as const;

export function isPlaceholder(value: string): boolean {
  return /^\[.+\]$/.test(value.trim());
}
