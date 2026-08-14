import type {
  BinConfig,
  FieldMeta,
  PlayingCard,
  PlayingCardWithDistance,
  ScannedCard,
} from "@poke-sort/shared";
import { describe, expect, it } from "vitest";
import { buildCorrection } from "./apply-correction";

const NO_BINS: BinConfig[] = [];
const NO_FIELDS: FieldMeta[] = [];

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
    score: 0.71,
    ...overrides,
  } as ScannedCard;
}

describe("buildCorrection", () => {
  it("resets distance on the corrected card", () => {
    const { corrected } = buildCorrection(
      card(),
      playingCard("base1-2", "Blastoise"),
      NO_BINS,
      NO_FIELDS,
    );
    expect(corrected).toEqual(withDistance("base1-2", "Blastoise", 0));
  });

  it("records what the pipeline predicted on the first correction", () => {
    const { provenance } = buildCorrection(
      card(),
      playingCard("base1-2", "Blastoise"),
      NO_BINS,
      NO_FIELDS,
    );
    expect(provenance).toEqual({
      originalCardId: "base1-4",
      originalDistance: 0.42,
      originalScore: 0.71,
      wasCorrected: true,
    });
  });

  // The invariant worth protecting: original_* is the *model's* answer. A
  // second correction must not overwrite it with the human's first one, or the
  // labelled eval data silently becomes human-vs-human.
  it("leaves provenance alone on a second correction", () => {
    const alreadyCorrected = card({
      wasCorrected: true,
      card: withDistance("base1-2", "Blastoise", 0),
      originalCardId: "base1-4",
    });
    const { provenance } = buildCorrection(
      alreadyCorrected,
      playingCard("base1-15", "Venusaur"),
      NO_BINS,
      NO_FIELDS,
    );
    expect(provenance).toEqual({});
  });

  it("survives a card that is not in the list", () => {
    const { corrected, provenance } = buildCorrection(
      undefined,
      playingCard("base1-2", "Blastoise"),
      NO_BINS,
      NO_FIELDS,
    );
    expect(corrected.distance).toBe(0);
    expect(provenance).toEqual({
      originalCardId: undefined,
      originalDistance: undefined,
      originalScore: undefined,
      wasCorrected: true,
    });
  });
});
