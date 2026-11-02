/** Every outbound link lives here. */
export const links = {
  repo: "https://github.com/JayanthMalladi/shim",
} as const;

export const founder = "Jayanth Malladi";

/**
 * Shim is published on npm as `getshim` (the `shim` package there is unrelated).
 * Run it from the repo you want to scan.
 */
export const scanCommands = ["cd your-app", "npx getshim scan ."] as const;
