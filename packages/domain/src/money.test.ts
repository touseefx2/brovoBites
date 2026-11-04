import { describe, expect, it } from "vitest";
import { formatPkr, money } from "./money";

describe("money", () => {
  it("rounds to nearest rupee", () => {
    expect(money(10.4)).toBe(10);
    expect(money(10.5)).toBe(11);
    expect(money(10.6)).toBe(11);
  });

  it("handles non-finite as 0", () => {
    expect(money(Number.NaN)).toBe(0);
    expect(money(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("formats PKR", () => {
    expect(formatPkr(580)).toContain("580");
    expect(formatPkr(580)).toMatch(/^Rs/);
  });
});
