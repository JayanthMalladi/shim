import { describe, expect, it } from "vitest";
import { allowsMajor } from "../src/bump.js";

describe("allowsMajor", () => {
  it.each([
    ["^7.0.11", true], ["~7.1.0", true], ["7.0.3", true], [">=6.0.0", true], [">=6.0.0 <8", true],
    ["^6 || ^7", true], ["5 || 6 || 7", true], ["*", true],
    ["^6.0.42", false], ["6.0.300", false], [">=6.0.182 <7", false], ["^5.0.0 || ^6.0.0", false],
  ])("%s allows 7: %s", (range, expected) => {
    expect(allowsMajor(range, 7)).toBe(expected);
  });
});
