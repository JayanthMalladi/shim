/** Every outbound link lives here. */
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
