/**
 * Every outbound link and launch placeholder lives here.
 * Values wrapped in [brackets] are unresolved placeholders: the UI marks them
 * with a dashed outline until they are replaced with real values.
 */
export const links = {
  waitlist: "[Join waitlist link]",
  githubApp: "[GitHub App install]",
  repo: "https://github.com/JayanthMalladi/shim",
  firstPr: "https://github.com/requestyai/ai-sdk-requesty/pull/66",
} as const;

export const placeholders = {
  price: "[PRICE]",
  founder: "[Founder name]",
} as const;

export const scanCommand = "npx shim scan .";
export const migrateCommand = "npx shim migrate . --agent";

export function isPlaceholder(value: string): boolean {
  return /^\[.+\]$/.test(value.trim());
}
