// Real i18n, so assertions read what a user reads rather than raw keys.
import "@/lib/i18n";
import type { CardPricing, PlayingCard } from "@poke-sort/shared";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { CardPricingPanel } from "./card-pricing-panel";

afterEach(cleanup);

/**
 * Verbatim from GET https://api.tcgdex.net/v2/en/cards/xy1-126 — the card whose
 * detail screen showed a bare $0.22 with no indication that the reverse holo of
 * the same card is worth $0.52.
 */
const XY1_126: CardPricing = {
  cardmarket: {
    updated: "2026-08-14T08:02:25.004Z",
    unit: "EUR",
    idProduct: 281463,
    avg: 0.27,
    low: 0.02,
    trend: 0.15,
    avg30: 0.2,
    "avg-holo": 0.94,
    "trend-holo": 0.68,
    "avg30-holo": 0.67,
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
    },
  },
};

/** base1-4: holofoil only, and the cardmarket -holo fields are null. */
const BASE1_4: CardPricing = {
  cardmarket: {
    unit: "EUR",
    avg: 402.79,
    trend: 397.58,
    avg30: 458.43,
    "avg-holo": null,
    "trend-holo": null,
    "avg30-holo": null,
  },
  tcgplayer: {
    unit: "USD",
    holofoil: {
      productId: 42382,
      lowPrice: 450,
      midPrice: 719.99,
      highPrice: 4610.88,
      marketPrice: 845.87,
    },
  },
};

function card(overrides: Partial<PlayingCard> = {}): PlayingCard {
  return {
    id: "xy1-126",
    name: "Shadow Circle",
    image: null,
    set: "xy1",
    setName: "XY",
    collectorNumber: "126",
    rarity: "uncommon",
    typeLine: "Trainer - Stadium",
    types: [],
    price: 0.22,
    pricing: XY1_126,
    ...overrides,
  };
}

describe("CardPricingPanel", () => {
  it("headlines the resolved printing and names it", () => {
    render(<CardPricingPanel card={card()} />);
    expect(screen.getByText("$0.22")).toBeDefined();
    expect(screen.getByText(/Normal/)).toBeDefined();
  });

  // The whole point: the number the old screen never showed.
  it("shows the other printing that is worth more", () => {
    render(<CardPricingPanel card={card()} />);
    expect(screen.getByText("Other printings")).toBeDefined();
    expect(screen.getByText("Reverse Holofoil")).toBeDefined();
    expect(screen.getByText("$0.52")).toBeDefined();
  });

  it("headlines the reverse holo when the app knows the card is one", () => {
    render(<CardPricingPanel card={card({ variant: "reverse" })} />);
    // $0.52 is now the headline, and $0.22 has moved to the other-printings row.
    expect(screen.getByText("$0.52")).toBeDefined();
    expect(screen.getByText(/Reverse Holofoil.*detected/)).toBeDefined();
  });

  // What the reverse-holo switch drives. The card's own variant is undefined
  // for essentially every modern card, so the override is the only way the
  // panel learns which printing is in hand.
  it("re-prices from the variant override, beating the card's own", () => {
    render(<CardPricingPanel card={card()} variant="reverse" />);
    expect(screen.getByText("$0.52")).toBeDefined();
    expect(screen.getByText(/Reverse Holofoil/)).toBeDefined();
  });

  it("falls back to the card's variant when no override is given", () => {
    render(<CardPricingPanel card={card({ variant: "reverse" })} />);
    expect(screen.getByText("$0.52")).toBeDefined();
  });

  it("shows the low/mid/high range of the resolved printing", () => {
    render(<CardPricingPanel card={card()} />);
    expect(screen.getByText("Low")).toBeDefined();
    expect(screen.getByText("$17.34")).toBeDefined();
  });

  it("links to the TCGplayer product page", () => {
    render(<CardPricingPanel card={card()} />);
    const link = screen.getByRole("link", { name: /TCGplayer/ });
    expect(link.getAttribute("href")).toBe(
      "https://www.tcgplayer.com/product/89095",
    );
  });

  it("headlines a holo-only card in USD", () => {
    render(<CardPricingPanel card={card({ pricing: BASE1_4, price: 845.87 })} />);
    expect(screen.getByText("$845.87")).toBeDefined();
  });

  // Cardmarket quotes EUR and there is no rate to convert with, so nothing
  // here may render in another currency.
  it("shows no currency other than USD", () => {
    const { container } = render(
      <CardPricingPanel card={card({ pricing: BASE1_4 })} />,
    );
    expect(container.textContent).not.toMatch(/[€£]/);
  });

  it("shows the direct-low price, the one you can actually buy at", () => {
    render(<CardPricingPanel card={card()} />);
    expect(screen.getByText("Direct low")).toBeDefined();
    expect(screen.getByText("$0.12")).toBeDefined();
  });

  it("omits the other-printings block when there is only one", () => {
    render(<CardPricingPanel card={card({ pricing: BASE1_4 })} />);
    expect(screen.queryByText("Other printings")).toBeNull();
  });

  // sv1-1, sv3pt5-6 and pgo-6 genuinely have no pricing key at all.
  it("keeps its shape when the card has no pricing", () => {
    render(<CardPricingPanel card={card({ pricing: undefined, raw: {} })} />);
    expect(screen.getByText("No USD pricing for this card")).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });

  // A few cards carry only Cardmarket's euro figures. Showing one beside the
  // dollar prices everywhere else would invite reading it as dollars, and
  // there is no exchange rate here to convert it with.
  it("declines to headline a euro price when there is no USD one", () => {
    const eurOnly: CardPricing = { cardmarket: { unit: "EUR", avg: 12.5 } };
    const { container } = render(
      <CardPricingPanel card={card({ pricing: eurOnly })} />,
    );
    expect(screen.getByText("No USD pricing for this card")).toBeDefined();
    expect(container.textContent).not.toMatch(/12[.,]5/);
  });

  it("reads pricing off raw for cards saved before the field existed", () => {
    render(
      <CardPricingPanel
        card={card({ pricing: undefined, raw: { pricing: XY1_126 } })}
      />,
    );
    expect(screen.getByText("$0.22")).toBeDefined();
  });

  it("renders a dash rather than a wrong number for a missing figure", () => {
    const partial: CardPricing = {
      tcgplayer: { normal: { marketPrice: 1.5, lowPrice: null } },
    };
    render(<CardPricingPanel card={card({ pricing: partial })} />);
    expect(screen.getByText("$1.50")).toBeDefined();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
