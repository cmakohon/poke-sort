// Real i18n, so assertions read what a user reads rather than raw keys.
import "@/lib/i18n";
import {
  POKEMON_FIELD_DEFINITIONS,
  type PlayingCardWithDistance,
} from "@poke-sort/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardDetailPanel } from "./card-detail-panel";

vi.mock("@/features/bins/api/use-bin-configs", () => ({
  useBinConfigs: () => ({
    configs: [],
    fieldDefinitions: POKEMON_FIELD_DEFINITIONS,
  }),
}));

afterEach(cleanup);

/**
 * Korrina, printed twice in Furious Fists — the ordinary art at 095/111 and a
 * full-art at 111/111. A scan of one matches both, so this card is the case the
 * candidate strip exists for, and the case where it takes over the screen.
 */
function korrina(id: string, number: string): PlayingCardWithDistance {
  return {
    id,
    name: "Korrina",
    image: { small: `/${id}.png`, normal: `/${id}.png` },
    set: "xy3",
    setName: "Furious Fists",
    collectorNumber: number,
    rarity: "uncommon",
    typeLine: "Trainer - Supporter",
    types: [],
    price: 2.91,
    distance: 0.1,
  };
}

const matched = korrina("xy3-95", "095");
const alternative = korrina("xy3-111", "111");

function renderPanel(showCandidates?: boolean) {
  return render(
    <CardDetailPanel
      scanId="scan-1"
      currentCard={matched}
      alternativeMatches={[alternative]}
      capturedImageUrl="/scan.jpg"
      onClose={() => {}}
      showCandidates={showCandidates}
    />,
  );
}

describe("CardDetailPanel candidate strip", () => {
  it("offers the other candidates while a card is being sorted", () => {
    renderPanel(true);
    expect(
      screen.getByText(/select the correct version below/i),
    ).toBeDefined();
    expect(screen.getByText(/#111/)).toBeDefined();
  });

  // In a collection the match is settled; the strip only crowds out the card.
  it("hides them for a card already filed in a collection", () => {
    renderPanel(false);
    expect(screen.queryByText(/select the correct version below/i)).toBeNull();
    expect(screen.queryByText(/#111/)).toBeNull();
  });

  it("still shows the scan and the matched card when they are hidden", () => {
    renderPanel(false);
    expect(screen.getByText(/Captured scan/i)).toBeDefined();
    expect(screen.getByAltText("Korrina")).toBeDefined();
  });

  // Correcting a filed card must stay reachable, or hiding the strip would
  // strand a mis-scan with no way to fix it from the collection screen.
  it("keeps the correct-card button available", () => {
    renderPanel(false);
    expect(screen.getByRole("button", { name: /correct card/i })).toBeDefined();
  });

  it("defaults to showing them, so the scan screen is unaffected", () => {
    renderPanel(undefined);
    expect(screen.getByText(/#111/)).toBeDefined();
  });
});
