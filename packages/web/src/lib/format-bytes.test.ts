import { describe, expect, it } from "vitest";
import { formatBytes } from "./format-bytes";

describe("formatBytes", () => {
  it("keeps small sizes in whole bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
  });

  it("uses base 1000, matching Finder rather than du", () => {
    expect(formatBytes(1000)).toBe("1.0 KB");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1_000_000)).toBe("1.0 MB");
  });

  it("drops the decimal past 100 so the column stays one width", () => {
    expect(formatBytes(4_100_000)).toBe("4.1 MB");
    expect(formatBytes(29_000_000)).toBe("29.0 MB");
    expect(formatBytes(252_000_000)).toBe("252 MB");
    expect(formatBytes(1_500_000_000)).toBe("1.5 GB");
  });

  it("renders an absent measurement as absent, not as zero", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});
