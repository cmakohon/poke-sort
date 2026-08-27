/**
 * Maps a card's market price to a filled tile on the scan grid.
 *
 * The tile used to be identical for a $60 card and a $0.12 one — the only
 * price signal was small muted text in the footer, which is unreadable at a
 * glance across a six-column grid while the machine is running.
 *
 * A tinted background was the first attempt and was not enough; these are
 * solid fills, and the tile switches its footer text to white to sit on them.
 *
 * The class strings are written out in full rather than interpolated from the
 * tier number: Tailwind scans source text for class names, and `bg-value-${n}`
 * produces nothing at build time.
 */

const TIERS: [min: number, classes: string][] = [
  [50, "bg-value-4 border-value-4"],
  [25, "bg-value-3 border-value-3"],
  [15, "bg-value-2 border-value-2"],
  [5, "bg-value-1 border-value-1"],
];

/** The cheapest tier's floor — also what the scan chime triggers on. */
export const VALUE_TIER_MIN = TIERS[TIERS.length - 1][0];

/** Tile background and border classes, or null for a card below every tier. */
export function valueTier(price: number | null | undefined): string | null {
  if (price == null) return null;
  for (const [min, classes] of TIERS) {
    if (price >= min) return classes;
  }
  return null;
}
