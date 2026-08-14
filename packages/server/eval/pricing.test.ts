import type { CardPricing } from "@poke-sort/shared";
import {
  getCardPricing,
  listPrintings,
  resolvePrintingKey,
  tcgplayerProductUrl,
} from "@poke-sort/shared";
import { describe, expect, it } from "vitest";

/**
 * Verbatim from `GET https://api.tcgdex.net/v2/en/cards/xy1-126`. The card in
 * the screenshot that started this: normal $0.22, reverse holo $0.52 — the
 * printing key that the old lookup could never match, because it spelled it
 * `reverseHolofoil` while upstream prints `reverse-holofoil`.
 */
const XY1_126: CardPricing = {
  cardmarket: {
    updated: "2026-08-14T08:02:25.004Z",
    unit: "EUR",
    idProduct: 281463,
    avg: 0.27,
    low: 0.02,
    trend: 0.15,
    avg1: 0.1,
    avg7: 0.29,
    avg30: 0.2,
    "avg-holo": 0.94,
    "low-holo": 0.25,
    "trend-holo": 0.68,
  },
  tcgplayer: {
    unit: "USD",
    updated: "2026-08-14T08:02:34.815Z",
    normal: {
      productId: 89095,
      lowPrice: 0.05,
      midPrice: 0.25,
      highPrice: 17.34,
      marketPrice: 0.22,
      directLowPrice: 0.12,
    },
    "reverse-holofoil": {
      productId: 89095,
      lowPrice: 0.25,
      midPrice: 0.5,
      highPrice: 19.98,
      marketPrice: 0.52,
      directLowPrice: 0.44,
    },
  },
};

/** Verbatim from base1-4 (Charizard): holofoil only, and cardmarket -holo null. */
const BASE1_4: CardPricing = {
  cardmarket: {
    unit: "EUR",
    idProduct: 273699,
    avg: 402.79,
    low: 105,
    trend: 397.58,
    avg30: 458.43,
    "avg-holo": null,
    "low-holo": null,
  },
  tcgplayer: {
    unit: "USD",
    holofoil: {
      productId: 42382,
      lowPrice: 450,
      midPrice: 719.99,
      highPrice: 4610.88,
      marketPrice: 845.87,
      directLowPrice: 612.06,
    },
  },
};

describe("resolvePrintingKey", () => {
  it("headlines normal when the printing is unknown", () => {
    // The overwhelmingly common case: variant is only ever set by the
    // 1st-Edition stamp detector, so it is undefined for modern cards.
    expect(resolvePrintingKey(XY1_126)).toEqual({
      key: "normal",
      detected: false,
    });
  });

  it("picks the reverse holo when the app knows it is one", () => {
    expect(resolvePrintingKey(XY1_126, "reverse")).toEqual({
      key: "reverse-holofoil",
      detected: true,
    });
  });

  it("falls past a printing the card does not have", () => {
    // base1-4 has no `normal`, so the unknown-variant order must skip it.
    expect(resolvePrintingKey(BASE1_4)).toEqual({
      key: "holofoil",
      detected: false,
    });
  });

  it("prices a stamped card as the printing it physically is", () => {
    // There is no firstEdition key upstream; holo is the right answer for the
    // Base-era cards the stamp detector actually fires on.
    expect(resolvePrintingKey(BASE1_4, "firstEdition")).toEqual({
      key: "holofoil",
      detected: true,
    });
  });

  it("still names a printing that has a range but no market price", () => {
    const noMarket: CardPricing = {
      tcgplayer: { normal: { lowPrice: 1, highPrice: 5, marketPrice: null } },
    };
    expect(resolvePrintingKey(noMarket)).toEqual({
      key: "normal",
      detected: false,
    });
  });

  it("returns null when there is no tcgplayer data", () => {
    expect(resolvePrintingKey(undefined)).toBeNull();
    expect(resolvePrintingKey({ cardmarket: { avg: 1 } })).toBeNull();
  });
});

describe("listPrintings", () => {
  it("returns only the printings that carry data, in order", () => {
    expect(listPrintings(XY1_126).map((p) => p.key)).toEqual([
      "normal",
      "reverse-holofoil",
    ]);
    expect(listPrintings(BASE1_4).map((p) => p.key)).toEqual(["holofoil"]);
    expect(listPrintings(undefined)).toEqual([]);
  });
});

describe("getCardPricing", () => {
  it("prefers the typed field over raw", () => {
    // The typed field is the live-refreshed one; raw is the pack-time snapshot.
    const card = { pricing: XY1_126, raw: { pricing: BASE1_4 } };
    expect(getCardPricing(card)).toBe(XY1_126);
  });

  it("falls back to raw for cards saved before the field existed", () => {
    expect(getCardPricing({ raw: { pricing: BASE1_4 } })).toBe(BASE1_4);
  });

  it("survives a card with neither", () => {
    expect(getCardPricing({})).toBeUndefined();
    expect(getCardPricing({ raw: "not an object" })).toBeUndefined();
    expect(getCardPricing({ raw: {} })).toBeUndefined();
  });
});

describe("tcgplayerProductUrl", () => {
  it("builds the product path, which resolves without a slug", () => {
    expect(tcgplayerProductUrl(42382)).toBe(
      "https://www.tcgplayer.com/product/42382",
    );
  });

  it("returns null rather than guessing a search URL", () => {
    expect(tcgplayerProductUrl(undefined)).toBeNull();
  });
});
