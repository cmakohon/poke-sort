/**
 * Maps a card's rarity to a CSS colour variable.
 *
 * Call sites used to interpolate the rarity straight into `var(--${rarity})`,
 * which works for Magic's single-word rarities and silently produces nothing
 * for Pokemon's: TCGdex returns "Double rare", "Holo Rare V", "Ultra Rare", and
 * `var(--double rare)` is not a valid custom property, so the dot rendered
 * transparent.
 *
 * Rather than enumerate forty TCGdex rarities, tiers are derived from keywords
 * and anything unrecognised falls back to a neutral colour.
 */

type Tier = "common" | "uncommon" | "rare" | "mythic";

const KEYWORD_TIERS: [RegExp, Tier][] = [
  // Order matters: "uncommon" contains "common".
  [/uncommon/, "uncommon"],
  [/\bcommon\b/, "common"],
  // The premium end of the Pokemon range.
  [/secret|hyper|crown|illustration|special|shiny|ultra|rainbow|gold|vmax|vstar|legend|prime|amazing|radiant|ace spec|black white|mega/, "mythic"],
  [/double rare|holo|\brare\b|\bex\b|\bv\b|star|diamond/, "rare"],
  [/promo/, "uncommon"],
];

export function rarityTier(rarity: string | undefined): Tier | null {
  if (!rarity) return null;
  const value = rarity.toLowerCase();
  for (const [pattern, tier] of KEYWORD_TIERS) {
    if (pattern.test(value)) return tier;
  }
  return null;
}

/** A CSS colour value, always safe to drop into a style attribute. */
export function rarityColor(rarity: string | undefined): string {
  const tier = rarityTier(rarity);
  return tier ? `var(--${tier})` : "var(--muted-foreground)";
}
