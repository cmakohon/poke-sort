import type {
  PlayingCard,
  PlayingCardWithDistance,
  ReviewCardSync,
  ScannedCard,
} from "@poke-sort/shared";
import { describe, expect, it } from "vitest";
import { mergeReviewSync } from "./apply-review-sync";

function playingCard(id: string, name: string): PlayingCard {
  return {
    id,
    name,
    image: null,
    set: "base1",
    setName: "Base Set",
    collectorNumber: "4",
    rarity: "Rare Holo",
    typeLine: "Pokemon",
    types: ["Fire"],
    price: null,
  };
}

function withDistance(
  id: string,
  name: string,
  distance: number,
): PlayingCardWithDistance {
  return { ...playingCard(id, name), distance };
}


function card(overrides: Partial<ScannedCard> = {}): ScannedCard {
  return {
    scanId: "scan-1",
    scannedAt: 0,
    card: withDistance("base1-4", "Charizard", 0.42),
    binNumber: 3,
    needsReview: true,
    ...overrides,
  } as ScannedCard;
}

function sync(overrides: Partial<ReviewCardSync> = {}): ReviewCardSync {
  return {
    scanId: "scan-1",
    collectionGuid: null,
    isStaged: true,
    needsReview: false,
    wasCorrected: false,
    originalCardId: null,
    originalDistance: null,
    originalScore: null,
    reviewVerdict: "correct",
    ...overrides,
  };
}

describe("mergeReviewSync", () => {
  it("stamps the verdict and clears the attention flag", () => {
    const result = mergeReviewSync(card(), sync());
    expect(result.reviewVerdict).toBe("correct");
    expect(result.needsReview).toBe(false);
  });

  it("swaps the card identity on a correction", () => {
    const result = mergeReviewSync(
      card(),
      sync({
        reviewVerdict: "corrected",
        wasCorrected: true,
        card: withDistance("base1-2", "Blastoise", 0),
        originalCardId: "base1-4",
        originalDistance: 0.42,
      }),
    );
    expect(result.card.name).toBe("Blastoise");
    expect(result.wasCorrected).toBe(true);
    expect(result.originalCardId).toBe("base1-4");
  });

  it("leaves the card alone when the verdict carries no new identity", () => {
    const result = mergeReviewSync(card(), sync());
    expect(result.card.name).toBe("Charizard");
  });

  // An "identity unknown" verdict pushes the card *back* into attention
  // rather than clearing it.
  it("re-flags an unresolvable card", () => {
    const result = mergeReviewSync(
      card({ needsReview: false }),
      sync({ reviewVerdict: "unresolvable", needsReview: true }),
    );
    expect(result.needsReview).toBe(true);
    expect(result.reviewVerdict).toBe("unresolvable");
  });

  it("preserves fields the verdict says nothing about", () => {
    const result = mergeReviewSync(card({ binNumber: 7 }), sync());
    expect(result.binNumber).toBe(7);
    expect(result.scanId).toBe("scan-1");
  });
});
