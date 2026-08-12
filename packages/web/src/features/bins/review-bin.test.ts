import {
  evaluateCardBin,
  getReviewBin,
  POKEMON_FIELD_DEFINITIONS,
  type BinConfig,
  type PlayingCardWithDistance,
} from "@poke-sort/shared";
import { describe, expect, it } from "vitest";

/**
 * Where a scan the pipeline does not trust ends up.
 *
 * Every uncertain card used to go to the catch-all, mixed in with the cards no
 * rule claimed. A dedicated review bin separates them, and the two properties
 * that matter are both silent when broken: an un-opted-in sort must keep
 * behaving exactly as before, and a rules-less review bin must not start
 * swallowing confident cards.
 *
 * Lives in web rather than shared because shared has no test runner, and web is
 * the caller — this is the decision the scanner makes on every scan.
 */

function bin(binNumber: number, extra: Partial<BinConfig> = {}): BinConfig {
  return {
    guid: `bin-${binNumber}`,
    binNumber,
    rules: { id: `g${binNumber}`, combinator: "and", conditions: [] },
    ...extra,
  };
}

const lightningBin = bin(1, {
  rules: {
    id: "g1",
    combinator: "and",
    conditions: [
      {
        id: "c1",
        field: "types",
        operator: "contains_any",
        value: ["Lightning"],
      },
    ],
  },
});

const pikachu = {
  id: "base1-58",
  name: "Pikachu",
  raw: { types: ["Lightning"] },
} as unknown as PlayingCardWithDistance;

describe("getReviewBin", () => {
  it("falls back to the catch-all when no bin is dedicated", () => {
    const configs = [lightningBin, bin(7, { isCatchAll: true })];
    expect(getReviewBin(configs)?.binNumber).toBe(7);
  });

  it("prefers the dedicated review bin over the catch-all", () => {
    const configs = [
      lightningBin,
      bin(6, { isReviewBin: true }),
      bin(7, { isCatchAll: true }),
    ];
    expect(getReviewBin(configs)?.binNumber).toBe(6);
  });

  it("returns nothing when a sort has neither", () => {
    expect(getReviewBin([lightningBin])).toBeUndefined();
  });
});

describe("evaluateCardBin with a review bin present", () => {
  const configs = [
    lightningBin,
    bin(6, { isReviewBin: true }),
    bin(7, { isCatchAll: true }),
  ];

  it("ignores the rules-less review bin when the card matches a rule", () => {
    expect(evaluateCardBin(pikachu, configs, POKEMON_FIELD_DEFINITIONS)
      ?.binNumber).toBe(1);
  });

  it("still sends an unmatched confident card to the catch-all", () => {
    const trainer = {
      id: "base1-88",
      name: "Bill",
      raw: { types: [] },
    } as unknown as PlayingCardWithDistance;
    expect(evaluateCardBin(trainer, configs, POKEMON_FIELD_DEFINITIONS)
      ?.binNumber).toBe(7);
  });

  it("lets a review bin carry rules of its own", () => {
    const reviewWithRules = bin(6, {
      isReviewBin: true,
      rules: {
        id: "g6",
        combinator: "and",
        conditions: [
          { id: "c6", field: "name", operator: "contains", value: "Bill" },
        ],
      },
    });
    const withRules = [reviewWithRules, bin(7, { isCatchAll: true })];
    const bill = {
      id: "base1-88",
      name: "Bill",
      raw: { name: "Bill" },
    } as unknown as PlayingCardWithDistance;
    expect(evaluateCardBin(bill, withRules, POKEMON_FIELD_DEFINITIONS)
      ?.binNumber).toBe(6);
    expect(getReviewBin(withRules)?.binNumber).toBe(6);
  });
});
