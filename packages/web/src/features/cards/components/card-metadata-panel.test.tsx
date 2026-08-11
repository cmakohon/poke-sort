// Real i18n, so assertions read what a user reads rather than raw keys.
import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import {
  POKEMON_FIELD_DEFINITIONS,
  type BinConfig,
  type PlayingCardWithDistance,
} from "@poke-sort/shared";
import { describe, expect, it, vi } from "vitest";
import { CardMetadataPanel } from "./card-metadata-panel";

/**
 * The scenario this panel exists for: a card the energy-type rule missed, and
 * a person trying to see why. The values shown must be the rule engine's view
 * (resolved off the raw upstream object), not the display fields — those
 * agreeing is the whole diagnostic value.
 */

const configs: BinConfig[] = [
  {
    guid: "bin-1",
    binNumber: 1,
    isCatchAll: false,
    rules: {
      id: "g1",
      combinator: "and",
      conditions: [
        { id: "c1", field: "types", operator: "contains_any", value: ["Lightning"] },
      ],
    },
  },
  {
    guid: "bin-7",
    binNumber: 7,
    isCatchAll: true,
    rules: { id: "g7", combinator: "and", conditions: [] },
  },
];

vi.mock("@/features/bins/api/use-bin-configs", () => ({
  useBinConfigs: () => ({
    configs,
    fieldDefinitions: POKEMON_FIELD_DEFINITIONS,
  }),
}));

const pikachu: PlayingCardWithDistance = {
  id: "base1-58",
  name: "Pikachu",
  image: null,
  set: "base1",
  setName: "Base Set",
  collectorNumber: "58",
  rarity: "common",
  typeLine: "Pokemon - Basic",
  types: ["Lightning"],
  price: null,
  distance: 0.05,
  raw: { id: "base1-58", name: "Pikachu", types: ["Lightning"], hp: 40 },
};

/** A Trainer: no energy type at all — the classic "why didn't my rule fire". */
const trainer: PlayingCardWithDistance = {
  id: "base1-91",
  name: "Bill",
  image: null,
  set: "base1",
  setName: "Base Set",
  collectorNumber: "91",
  rarity: "common",
  typeLine: "Trainer",
  types: [],
  price: null,
  distance: 0.06,
  raw: { id: "base1-91", name: "Bill", category: "Trainer" },
};

describe("CardMetadataPanel", () => {
  it("shows the value the rule engine resolves for energy type", () => {
    render(<CardMetadataPanel card={pikachu} assignedBin={1} />);
    expect(screen.getByText("Energy Type")).toBeDefined();
    expect(screen.getByText("Lightning")).toBeDefined();
    // And the re-evaluation agrees with where it was sent.
    expect(screen.getByText(/Bin 1/)).toBeDefined();
  });

  it("shows an explicit empty for a card the rule cannot match", () => {
    render(<CardMetadataPanel card={trainer} assignedBin={7} />);
    // Bill has no types: the energy row exists and says so, rather than the
    // field silently not appearing — absence of evidence, made visible.
    const empties = screen.getAllByText("(none)");
    expect(empties.length).toBeGreaterThan(0);
    // Rules route it to the catch-all.
    expect(screen.getByText(/Bin 7/)).toBeDefined();
    expect(screen.getByText(/catch-all/)).toBeDefined();
  });

  it("flags a disagreement between rules-today and the assigned bin", () => {
    // Sent to bin 3 at scan time (e.g. review-tier catch-all routing), but
    // today's rules would put it in bin 1 — the badge is the diagnosis.
    render(<CardMetadataPanel card={pikachu} assignedBin={3} />);
    expect(screen.getByText(/sent to bin 3 at scan time/)).toBeDefined();
  });
});
