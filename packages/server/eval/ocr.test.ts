import { describe, expect, it } from "vitest";
import { parseCollectorNumber } from "../src/lib/identify/ocr";

/**
 * Denominator plausibility.
 *
 * Across a 97-scan review batch, 5 scans parsed a printed denominator that no
 * Pokémon set has (0, 710, 716, 901 — the catalog's largest real set is 307).
 * Each came from OCR straddling a slash in the copyright line. setTotal is the
 * flag meaning "a full number was read", so a bogus one both overwrote a
 * better collector number and skipped the escalation retry in readCard. One of
 * the five is the direct cause of a misidentification: "20/901" for a card
 * printed 21/101.
 */
describe("parseCollectorNumber", () => {
  it("reads an ordinary printed fraction", () => {
    expect(parseCollectorNumber("58/102")).toEqual({
      collectorNumber: "58",
      setTotal: 102,
    });
  });

  it("strips the zero padding modern sets print", () => {
    expect(parseCollectorNumber("022/095")).toEqual({
      collectorNumber: "22",
      setTotal: 95,
    });
  });

  it("tolerates the noise OCR leaves around the number", () => {
    expect(parseCollectorNumber("(ED 072/086 0 lol")).toEqual({
      collectorNumber: "72",
      setTotal: 86,
    });
  });

  it.each([
    ["901", "ED 20/901 aE 2025 Pokemon"],
    ["716", "l 12/716 GAME FREAK"],
    ["710", "IL 4/710 Nintendo"],
    ["000", "(ED 072/000 0 lol"],
  ])("refuses an impossible denominator (%s)", (_label, text) => {
    const parsed = parseCollectorNumber(text);
    // The numerator survives as a weak fallback, but without setTotal — which
    // is what lets readCard escalate instead of locking the bad reading in.
    expect(parsed?.setTotal).toBeUndefined();
  });

  it("keeps the largest real set size", () => {
    // The catalog's biggest set is 307; anything up to the bound must pass.
    expect(parseCollectorNumber("150/307")?.setTotal).toBe(307);
    expect(parseCollectorNumber("1/400")?.setTotal).toBe(400);
  });

  it("still handles promos with no denominator", () => {
    expect(parseCollectorNumber("SVP 001")).toEqual({ collectorNumber: "1" });
  });

  it("falls back to a bare number", () => {
    expect(parseCollectorNumber("no fraction 58 here")).toEqual({
      collectorNumber: "58",
    });
  });

  it("returns null when there is no number at all", () => {
    expect(parseCollectorNumber("Creatures / GAME FREAK")).toBeNull();
  });
});
