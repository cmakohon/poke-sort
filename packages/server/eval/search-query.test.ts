/**
 * What counts as a collector number.
 *
 * The whole point of this parse is that a reviewer can type what is printed on
 * the card. Getting it wrong in either direction is a real failure: miss a
 * number and the lookup is name-only again, claim a number where there is a
 * name and a search for "Porygon2" runs against the wrong column and finds
 * nothing.
 */
import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "../src/lib/card-search/query";

describe("parseSearchQuery", () => {
  it("reads a bare number", () => {
    const parsed = parseSearchQuery("102");
    expect(parsed.name).toBe("");
    expect(parsed.numbers).toContain("102");
    expect(parsed.setTotal).toBeNull();
  });

  it("reads a promo number with a set prefix", () => {
    const parsed = parseSearchQuery("sm125");
    expect(parsed.name).toBe("");
    // The catalog stores these uppercase; the reviewer types either.
    expect(parsed.numbers).toContain("SM125");
    expect(parsed.numbers).toContain("sm125");
  });

  it("reads the printed fraction", () => {
    const parsed = parseSearchQuery("4/102");
    expect(parsed.numbers).toContain("4");
    expect(parsed.setTotal).toBe(102);
  });

  it("covers both spellings of a zero-padded number", () => {
    const parsed = parseSearchQuery("007");
    expect(parsed.numbers).toContain("007");
    expect(parsed.numbers).toContain("7");
    // And the other direction, for a catalog that pads what the card does not.
    expect(parseSearchQuery("7").numbers).toContain("007");
  });

  it("keeps a name and a number apart", () => {
    const parsed = parseSearchQuery("charizard 4");
    expect(parsed.name).toBe("charizard");
    expect(parsed.numbers).toContain("4");
  });

  it("does not mistake a name that ends in a digit for a number", () => {
    // Seven letters of prefix — past the bound a real collector number uses.
    const parsed = parseSearchQuery("porygon2");
    expect(parsed.name).toBe("porygon2");
    expect(parsed.numbers).toEqual([]);
  });

  it("does not mistake a set code for a number", () => {
    const parsed = parseSearchQuery("swsh4 pikachu");
    expect(parsed.name).toBe("swsh4 pikachu");
    expect(parsed.numbers).toEqual([]);
  });

  it("handles the trainer-gallery style number", () => {
    expect(parseSearchQuery("TG12").numbers).toContain("TG12");
    expect(parseSearchQuery("h1").numbers).toContain("H1");
  });

  it("is empty for an ordinary name", () => {
    const parsed = parseSearchQuery("poké ball");
    expect(parsed.name).toBe("poké ball");
    expect(parsed.numbers).toEqual([]);
    expect(parsed.setTotal).toBeNull();
  });
});
