/**
 * Maps a card's market price to a visual tier on the scan grid.
 *
 * The tile used to be identical for a $60 card and a $0.12 one — the only
 * price signal was small muted text in the footer, which is unreadable at a
 * glance across a six-column grid while the machine is running.
 *
 * The class strings are written out in full rather than interpolated from the
 * tier number: Tailwind scans source text for class names, and `bg-value-${n}`
 * produces nothing at build time.
 */

export interface ValueTier {
  /** Background tint + border for the tile root. */
  tile: string;
  /** Colour for the price text in the tile footer. */
  price: string;
}

const TIERS: [min: number, tier: ValueTier][] = [
  [50, { tile: "bg-value-4/12 border-value-4/50", price: "text-value-4" }],
  [25, { tile: "bg-value-3/12 border-value-3/50", price: "text-value-3" }],
  [15, { tile: "bg-value-2/12 border-value-2/50", price: "text-value-2" }],
  [5, { tile: "bg-value-1/12 border-value-1/50", price: "text-value-1" }],
];

/** The cheapest tier's floor — also what the scan chime triggers on. */
export const VALUE_TIER_MIN = TIERS[TIERS.length - 1][0];

export function valueTier(price: number | null | undefined): ValueTier | null {
  if (price == null) return null;
  for (const [min, tier] of TIERS) {
    if (price >= min) return tier;
  }
  return null;
}
