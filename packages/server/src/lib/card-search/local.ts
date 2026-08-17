import { QUERY_MIN_LENGTH, type PlayingCard } from "@poke-sort/shared";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { hydrateCatalogCard, type CatalogCardRow } from "../catalog-card";
import { getSetInfo } from "../set-index";

/**
 * Correction search, against the local catalog.
 *
 * This used to proxy to TCGdex with `pagination:itemsPerPage=30`, page one
 * only, in whatever order upstream returned — so a common Pokemon's right
 * printing was often simply unreachable, and the set dropdown (filtering those
 * same 30 rows client-side) made the truncation invisible.
 *
 * The local `cards` table already holds every printing the sorter could
 * possibly have scanned, with the full upstream object in `card_data`. Reading
 * it here means the whole catalog is reachable, results are ranked, there is no
 * per-keystroke fan-out of 30 detail fetches, and correcting a card works with
 * the network down. The cost is that a set released since the last catalog sync
 * is not searchable — but neither is it identifiable, so it could not have been
 * mis-scanned in the first place.
 */

/** Enough to fill the picker's grid without an immediate second page. */
export const SEARCH_PAGE_SIZE = 60;
const SEARCH_PAGE_MAX = 200;

/** Matches the `lang` column's own default, for callers that name only a game. */
export const DEFAULT_CATALOG_LANG = "en";

export interface CardSearchSetFacet {
  code: string;
  name: string;
  count: number;
}

export interface CardSearchPage {
  cards: PlayingCard[];
  /** Rows matching the query, across every page. */
  total: number;
  page: number;
  limit: number;
  /** Every set represented in the whole match, not just this page. */
  sets: CardSearchSetFacet[];
}

export interface CardSearchOptions {
  gameKey: string;
  lang: string;
  query: string;
  setCode?: string;
  page?: number;
  limit?: number;
}

/** Query params arrive as strings, so a non-number reads as its default. */
const whole = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) ? Math.trunc(value as number) : fallback;

function pageBounds(options: CardSearchOptions) {
  const limit = Math.min(
    SEARCH_PAGE_MAX,
    Math.max(1, whole(options.limit, SEARCH_PAGE_SIZE)),
  );
  const page = Math.max(1, whole(options.page, 1));
  return { limit, page, offset: (page - 1) * limit };
}

export async function searchLocalCatalog(
  options: CardSearchOptions,
): Promise<CardSearchPage> {
  const query = options.query.trim();
  const { limit, page, offset } = pageBounds(options);
  if (query.length < QUERY_MIN_LENGTH) {
    return { cards: [], total: 0, page, limit, sets: [] };
  }

  const pattern = `%${query}%`;
  const where = sql`game_key = ${options.gameKey}
      AND lang = ${options.lang}
      AND name ILIKE ${pattern}
      ${options.setCode ? sql`AND set_code = ${options.setCode}` : sql``}`;

  const [rows, counts, sets] = await Promise.all([
    db.execute<CatalogCardRow>(sql`
      SELECT card_id, name, collector_number, set_code, card_data
      FROM cards
      WHERE ${where}
      -- Relevance, since the table has no notion of it: an exact name first,
      -- then names that start with the query, then the shortest — which puts
      -- "Charizard" above "Charizard ex" and "Dark Charizard". Set and number
      -- only break the remaining ties, so a card's printings stay together.
      ORDER BY (lower(name) = lower(${query})) DESC,
               (lower(name) LIKE lower(${query}) || '%') DESC,
               length(name),
               name,
               set_code,
               collector_number
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total FROM cards WHERE ${where}
    `),
    // Over the whole match rather than the page, so choosing a set from the
    // dropdown can reach printings that page one never showed — the exact
    // failure the old client-side filter had.
    db.execute<{ set_code: string; count: number }>(sql`
      SELECT set_code, count(*)::int AS count
      FROM cards
      WHERE ${where}
      GROUP BY set_code
      ORDER BY count DESC, set_code
    `),
  ]);

  return {
    cards: rows.rows.map((row) => hydrateCatalogCard(options.gameKey, row)),
    total: counts.rows[0]?.total ?? 0,
    page,
    limit,
    sets: sets.rows.map((row) => ({
      code: row.set_code,
      name: getSetInfo(row.set_code)?.name ?? row.set_code,
      count: row.count,
    })),
  };
}
