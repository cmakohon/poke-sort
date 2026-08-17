import type { PlayingCard } from "@poke-sort/shared";
import {
  normalizePokemonCard,
  type PokemonCardDetail,
} from "./pokemon/search";

/** The catalog columns every consumer of a `cards` row can count on. */
export interface CatalogCardRow extends Record<string, unknown> {
  card_id: string;
  name: string;
  collector_number: string | null;
  set_code: string;
  card_data: unknown;
}

/** Enough of a card to display and to sort on, built from the columns alone. */
export function minimalCatalogCard(row: CatalogCardRow): PlayingCard {
  return {
    id: row.card_id,
    name: row.name,
    image: null,
    set: row.card_id.split("-")[0] ?? "",
    setName: "",
    collectorNumber: row.collector_number ?? "",
    rarity: "",
    typeLine: "",
    types: [],
    price: null,
  };
}

/**
 * Rebuilds the client-facing card from the stored upstream object.
 *
 * The one place a catalog row becomes a PlayingCard, shared by the identify
 * pipeline and the correction search so `card.raw` keeps the shape the bin rule
 * engine resolves its paths against — two normalizers would eventually disagree
 * about a field a rule depends on.
 *
 * Cards synced before the card_data column existed have no stored object; they
 * degrade to the indexed columns rather than to null, because the client drops
 * candidates it cannot render and the right card would simply vanish.
 */
export function hydrateCatalogCard(
  gameKey: string,
  row: CatalogCardRow,
): PlayingCard {
  const data = row.card_data;
  if (data && typeof data === "object" && gameKey === "pokemon") {
    try {
      return normalizePokemonCard(data as PokemonCardDetail);
    } catch {
      // A malformed stored object should not take the whole scan down.
      return minimalCatalogCard(row);
    }
  }
  return minimalCatalogCard(row);
}
