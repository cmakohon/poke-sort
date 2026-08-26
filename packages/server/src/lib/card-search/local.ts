import { QUERY_MIN_LENGTH, type PlayingCard } from "@poke-sort/shared";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db";
import { hydrateCatalogCard, type CatalogCardRow } from "../catalog-card";
import { getSetInfo } from "../set-index";
import { parseSearchQuery, type ParsedSearchQuery } from "./query";

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
 * the network down.
 *
 * It matches on name and on collector number (see ./query.ts) — a reviewer
 * holding a card can type either what it is called or what is printed on it.
 *
 * What it cannot reach is a printing the catalog never imported: the sync skips
 * every card upstream has no image for, which is a real and sizeable set. That
 * is what the adapter's searchByName fallback is for, offered from the picker
 * once this search comes back empty.
 */

/** Enough to fill the picker's grid without an immediate second page. */
export const SEARCH_PAGE_SIZE = 60;
const SEARCH_PAGE_MAX = 200;

/** Matches the `lang` column's own default, for callers that name only a game. */
export const DEFAULT_CATALOG_LANG = "en";

/**
 * Folds a name (or a query) to the form both sides of the search compare on.
 *
 * Card names are full of characters nobody types. ILIKE is literal, so
 * "Poke Ball" matched zero rows while "Poké Ball" matched 24 — the printing was
 * in the catalog and simply unreachable, which read as the search truncating
 * its results. The same held for "Farfetchd", "Ho Oh", "Type Null" and every
 * trainer card whose apostrophe is the curly U+2019 rather than U+0027.
 *
 * The folding: lowercase; é to e (the only accented letter in the catalog);
 * both apostrophes deleted, so "Bills Analysis" reaches "Bill’s Analysis"; and
 * every other run of non-alphanumerics collapsed to a single space, so "Ho Oh"
 * reaches "Ho-Oh". The remaining oddities (♀ ♂ ☆ ◇ δ, katakana) are decorative
 * and become separators, which is what makes "Nidoran" reach "Nidoran♀".
 *
 * MUST stay character-for-character identical to the expression indexed by
 * cards_name_search_idx (drizzle/0020). A divergence still returns correct
 * rows, but silently stops using the index and sequentially scans ~22k rows on
 * every debounced keystroke — and PGlite runs on the main thread and cannot
 * cancel, so that stalls the server, an active sort included.
 */
const folded = (expr: SQL) =>
  sql`btrim(regexp_replace(translate(lower(${expr}), 'é''’', 'e'), '[^a-z0-9]+', ' ', 'g'))`;

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

/** The columns and filters every shape of this search shares. */
function baseWhere(options: CardSearchOptions) {
  return sql`game_key = ${options.gameKey}
      AND lang = ${options.lang}
      ${options.setCode ? sql`AND set_code = ${options.setCode}` : sql``}`;
}

interface SearchShape {
  where: SQL;
  orderBy: SQL;
}

function nameShape(options: CardSearchOptions, query: string): SearchShape {
  const name = folded(sql`name`);
  const needle = folded(sql`${query}`);
  return {
    // A query that folds away to nothing — pure punctuation, or a script the
    // folding does not keep, like katakana against a Japanese catalog — would
    // otherwise leave LIKE '%' || '' || '%', matching every row for the game.
    // Tested on the folded value rather than the raw one: a JS-side check would
    // have to reimplement the folding to agree with it, and the two would drift.
    where: sql`${baseWhere(options)}
      AND ${needle} <> ''
      AND ${name} LIKE '%' || ${needle} || '%'`,
    // Relevance, since the table has no notion of it: an exact name first,
    // then names that start with the query, then the shortest — which puts
    // "Charizard" above "Charizard ex" and "Dark Charizard". Set and number
    // only break the remaining ties, so a card's printings stay together.
    // Ranked on the folded forms too, so typing "Poke Ball" still ranks
    // "Poké Ball" as the exact match it is.
    orderBy: sql`(${name} = ${needle}) DESC,
               (${name} LIKE ${needle} || '%') DESC,
               length(name),
               name,
               set_code,
               collector_number`,
  };
}

/**
 * A collector number, optionally narrowed by a name and a set total.
 *
 * Deliberately a separate shape rather than an OR against the name condition:
 * an OR spanning cards_name_search_idx and cards_collector_number_idx drops the
 * planner onto a sequential scan of the whole catalog, and PGlite runs on the
 * main thread and cannot cancel — that is a stall mid-sort, not a slow search.
 */
function numberShape(
  options: CardSearchOptions,
  parsed: ParsedSearchQuery,
  setTotal: number | null,
): SearchShape {
  const name = folded(sql`name`);
  const needle = folded(sql`${parsed.name}`);
  const hasName = parsed.name.length >= QUERY_MIN_LENGTH;
  return {
    where: sql`${baseWhere(options)}
      AND collector_number IN (${sql.join(
        parsed.numbers.map((n) => sql`${n}`),
        sql`, `,
      )})
      ${setTotal != null ? sql`AND set_total = ${setTotal}` : sql``}
      ${hasName ? sql`AND ${name} LIKE '%' || ${needle} || '%'` : sql``}`,
    orderBy: sql`name, set_code, collector_number`,
  };
}

/**
 * The number shapes to try, tightest first.
 *
 * A printed fraction narrows by set_total when it can, but that column is
 * nullable and the sync writes whatever upstream had — and a secret rare's
 * printed denominator is not its set's count anyway. Dropping the denominator
 * has to be its own attempt, because the name search cannot rescue a fraction
 * the way it rescues "charizard 5": "4/102" folds to "4 102" and matches no
 * card that has ever been printed.
 */
function numberShapes(
  options: CardSearchOptions,
  parsed: ParsedSearchQuery,
): SearchShape[] {
  if (parsed.numbers.length === 0) return [];
  const loose = numberShape(options, parsed, null);
  return parsed.setTotal == null
    ? [loose]
    : [numberShape(options, parsed, parsed.setTotal), loose];
}

/** Rows matching a shape, across every page. */
async function totalFor(where: SQL): Promise<number> {
  const counts = await db.execute<{ total: number }>(sql`
    SELECT count(*)::int AS total FROM cards WHERE ${where}
  `);
  return counts.rows[0]?.total ?? 0;
}

async function pageFor(
  options: CardSearchOptions,
  shape: SearchShape,
  bounds: { limit: number; page: number; offset: number },
  total: number,
): Promise<CardSearchPage> {
  const { where, orderBy } = shape;
  const { limit, page, offset } = bounds;
  const [rows, sets] = await Promise.all([
    db.execute<CatalogCardRow>(sql`
      SELECT card_id, name, collector_number, set_code, card_data
      FROM cards
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
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
    total,
    page,
    limit,
    sets: sets.rows.map((row) => ({
      code: row.set_code,
      name: getSetInfo(row.set_code)?.name ?? row.set_code,
      count: row.count,
    })),
  };
}

export async function searchLocalCatalog(
  options: CardSearchOptions,
): Promise<CardSearchPage> {
  const query = options.query.trim();
  const bounds = pageBounds(options);
  const empty: CardSearchPage = {
    cards: [],
    total: 0,
    page: bounds.page,
    limit: bounds.limit,
    sets: [],
  };
  if (query.length < QUERY_MIN_LENGTH) return empty;

  // Count before fetching, rather than issuing all three queries at once. A
  // shape that matches nothing then costs one indexed count instead of a page
  // and a facet aggregate as well — and every query here runs on the thread
  // the sorter is using. Nothing is lost by serialising: PGlite executes them
  // one at a time regardless.
  const parsed = parseSearchQuery(query);
  for (const shape of numberShapes(options, parsed)) {
    const total = await totalFor(shape.where);
    // Only a hit counts. A name that merely looks like a collector number —
    // or a number this catalog spells some way the variants do not cover —
    // must not come out worse than it did when every query was a name.
    if (total > 0) return pageFor(options, shape, bounds, total);
  }

  // Falling back on the words rather than the whole string: "charizard 5" with
  // no card 5 should still show the Charizards, not nothing.
  const asName = parsed.name.length >= QUERY_MIN_LENGTH ? parsed.name : query;
  const shape = nameShape(options, asName);
  const total = await totalFor(shape.where);
  return total > 0 ? pageFor(options, shape, bounds, total) : empty;
}
