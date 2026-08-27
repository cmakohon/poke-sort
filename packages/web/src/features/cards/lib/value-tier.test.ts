import { describe, expect, it } from "vitest";

import { VALUE_TIER_MIN, valueTier } from "./value-tier";

describe("valueTier", () => {
  it("has no tier below the cheapest threshold", () => {
    expect(valueTier(0)).toBeNull();
    expect(valueTier(4.99)).toBeNull();
  });

  it("treats an unpriced card as untiered rather than free", () => {
    expect(valueTier(null)).toBeNull();
    expect(valueTier(undefined)).toBeNull();
  });

  it("includes the threshold itself in the tier it opens", () => {
    expect(valueTier(5)).not.toBeNull();
    expect(valueTier(5)).toEqual(valueTier(14.99));
    expect(valueTier(50)).toEqual(valueTier(1000));
    expect(valueTier(50)).not.toEqual(valueTier(49.99));
  });

  it("gives each band a distinct colour", () => {
    const bands = [5, 15, 25, 50].map((p) => valueTier(p));
    expect(bands.every(Boolean)).toBe(true);
    expect(new Set(bands).size).toBe(4);
  });

  it("chimes at the same price the first tint appears", () => {
    expect(valueTier(VALUE_TIER_MIN)).not.toBeNull();
    expect(valueTier(VALUE_TIER_MIN - 0.01)).toBeNull();
  });
});
