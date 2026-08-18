import type { PlayingCardWithDistance } from "@poke-sort/shared";
import { describe, expect, it } from "vitest";

import { repriceAsReverseHolo } from "./reverse-holo-pricing";

function makeCard(
  pricing?: PlayingCardWithDistance["pricing"],
): PlayingCardWithDistance {
  return {
    id: "swsh1-1",
    name: "Celebi V",
    set: "swsh1",
    price: 1.5,
    pricing,
    distance: 0.05,
  } as PlayingCardWithDistance;
}

describe("repriceAsReverseHolo", () => {
  it("rewrites price to the reverse-holofoil market price", () => {
    const card = makeCard({
      tcgplayer: {
        normal: { marketPrice: 1.5 },
        "reverse-holofoil": { marketPrice: 6.25 },
      },
    });
    const repriced = repriceAsReverseHolo(card);
    expect(repriced.price).toBe(6.25);
  });

  it("leaves the price alone when the resolved printing has no market price", () => {
    const card = makeCard({
      tcgplayer: {
        normal: { marketPrice: 1.5 },
        "reverse-holofoil": { marketPrice: null },
      },
    });
    // resolvePrintingKey falls back through the printing order; with no
    // priced reverse printing the stale normal price must survive untouched.
    expect(repriceAsReverseHolo(card).price).toBe(1.5);
  });

  it("returns the card unchanged when it has no pricing at all", () => {
    const card = makeCard(undefined);
    expect(repriceAsReverseHolo(card)).toBe(card);
  });

  it("does not mutate the input card", () => {
    const card = makeCard({
      tcgplayer: { "reverse-holofoil": { marketPrice: 6.25 } },
    });
    repriceAsReverseHolo(card);
    expect(card.price).toBe(1.5);
  });
});
