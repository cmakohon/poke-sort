import { rarityTier } from "@/features/cards/lib/rarity-color";
import type { SetStats } from "@/features/scanner/types";
import type { ScannedCard } from "@poke-sort/shared";

/**
 * Swatches for TCGdex's energy type vocabulary. Anything not listed still
 * renders — it just falls back to a neutral chip rather than a themed one.
 */
const ENERGY_TYPE_SWATCHES: Record<string, string> = {
  Grass: "#7DB343",
  Fire: "#E8483F",
  Water: "#4BA5D9",
  Lightning: "#F5C518",
  Psychic: "#A45DC4",
  Fighting: "#C06A3B",
  Darkness: "#2F4858",
  Metal: "#9AA5B1",
  Dragon: "#B8912F",
  Fairy: "#E88BB8",
  Colorless: "#D8D8D8",
};

/** Premium first, then plain rarities, then anything unrecognised. */
const TIER_ORDER = ["mythic", "rare", "uncommon", "common"];

/**
 * Series and set symbol come off the card's upstream object, which the server
 * enriches at normalize time. Cards scanned before that enrichment simply have
 * neither and fall back to an "Other" group.
 */
function readSet(
  raw: unknown,
): { serie?: { name?: string }; symbol?: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const set = (raw as { set?: unknown }).set;
  return set && typeof set === "object" ? (set as never) : undefined;
}

function capitalize(value: string): string {
  return value.length > 0
    ? value.charAt(0).toUpperCase() + value.slice(1)
    : value;
}

function sortRarities<T extends { key: string; count: number }>(
  entries: T[],
): T[] {
  // Pokemon prints ~40 distinct rarity strings, so they are ordered by the tier
  // they map to rather than by an enumerated list, and ties break on count.
  return [...entries].sort((a, b) => {
    const orderA = TIER_ORDER.indexOf(rarityTier(a.key) ?? "");
    const orderB = TIER_ORDER.indexOf(rarityTier(b.key) ?? "");
    if (orderA !== -1 && orderB !== -1 && orderA !== orderB) {
      return orderA - orderB;
    }
    if (orderA !== -1 && orderB === -1) return -1;
    if (orderB !== -1 && orderA === -1) return 1;
    return b.count - a.count;
  });
}

export interface ScanStats {
  totalCount: number;
  uniqueCount: number;
  totalValue: number;
  avgValue: number;
  hasPricing: boolean;
  mostValuable: { name: string; price: number } | null;
  sets: SetStats[];
  rarities: { key: string; label: string; count: number }[];
  types: { key: string; label: string; bg: string; count: number }[];
}

export function computeStats(cards: ScannedCard[]): ScanStats | null {
  if (cards.length === 0) return null;

  let totalValue = 0;
  let priceableCount = 0;
  const setMap = new Map<string, SetStats>();
  const rarityMap = new Map<string, number>();
  const typeMap = new Map<string, number>();
  let mostValuable: { name: string; price: number } | null = null;
  const uniqueCards = new Set<string>();

  for (const entry of cards) {
    const c = entry.card;
    const price = c.price ?? 0;

    uniqueCards.add(c.id);

    if (price > 0) {
      totalValue += price;
      priceableCount++;
    }

    if (price > 0 && (!mostValuable || price > mostValuable.price)) {
      mostValuable = { name: c.name, price };
    }

    const existing = setMap.get(c.set);
    if (existing) {
      existing.count++;
      existing.value += price;
    } else {
      const setRaw = readSet(c.raw);
      setMap.set(c.set, {
        code: c.set,
        name: c.setName,
        count: 1,
        value: price,
        serieName: setRaw?.serie?.name,
        symbol: setRaw?.symbol
          ? `/api/cards/image-proxy?url=${encodeURIComponent(`${setRaw.symbol}.webp`)}`
          : null,
      });
    }

    if (c.rarity) {
      rarityMap.set(c.rarity, (rarityMap.get(c.rarity) ?? 0) + 1);
    }

    for (const type of c.types) {
      typeMap.set(type, (typeMap.get(type) ?? 0) + 1);
    }
  }

  return {
    totalCount: cards.length,
    uniqueCount: uniqueCards.size,
    totalValue,
    avgValue: priceableCount > 0 ? totalValue / priceableCount : 0,
    hasPricing: priceableCount > 0,
    mostValuable,
    sets: Array.from(setMap.values()).sort(
      (a, b) => b.value - a.value || b.count - a.count,
    ),
    rarities: sortRarities(
      Array.from(rarityMap.entries()).map(([key, count]) => ({
        key,
        label: capitalize(key),
        count,
      })),
    ),
    types: Array.from(typeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({
        key,
        label: key,
        bg: ENERGY_TYPE_SWATCHES[key] ?? "#94979A",
        count,
      })),
  };
}
