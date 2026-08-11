import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { cardImageVectors } from "../db/schema";
import {
  assetUrl,
  getSeriesInfo,
  getSetInfo,
  releaseYear,
  type SetInfo,
} from "./set-index";

/**
 * Which values actually exist in the local catalog, for populating filter and
 * bin-rule pickers.
 *
 * Static option lists baked into `field_definitions` work for small fixed
 * vocabularies (11 energy types, forever) but not for sets: there are 218 and
 * more every quarter, so a hardcoded list is stale on release day. These are
 * derived from the rows actually present, which also means the picker never
 * offers a set whose cards you do not have.
 *
 * Computed once and cached: it is a full scan of ~23k rows, cheap enough to do
 * on demand but not on every keystroke. Invalidated when the catalog changes.
 */

export interface FacetValue {
  value: string;
  label: string;
  count: number;
}

export interface SetFacet extends FacetValue {
  serieId: string;
  serieName: string;
  symbol: string | null;
  releaseYear: number | null;
}

export interface SeriesFacet extends FacetValue {
  logo: string | null;
  /** Sets belonging to this series that are present in the catalog. */
  sets: SetFacet[];
}

export interface GameFacets {
  gameKey: string;
  lang: string;
  totalCards: number;
  /** Sets grouped under their series, newest series first. */
  series: SeriesFacet[];
  /** Flat vocabularies, each sorted by descending count. */
  rarity: FacetValue[];
  types: FacetValue[];
  category: FacetValue[];
  stage: FacetValue[];
  trainerType: FacetValue[];
  weakness: FacetValue[];
  illustrator: FacetValue[];
  regulationMark: FacetValue[];
  computedAt: string;
}

const cache = new Map<string, GameFacets>();

const keyOf = (gameKey: string, lang: string) => `${gameKey}::${lang}`;

/** Call after any change to the catalog (sync, pack import). */
export function invalidateFacets(): void {
  cache.clear();
}

interface FacetRow extends Record<string, unknown> {
  set_code: string;
  card_data: unknown;
}

function tally(map: Map<string, number>, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  const key = String(value);
  map.set(key, (map.get(key) ?? 0) + 1);
}

function toFacets(map: Map<string, number>): FacetValue[] {
  return [...map.entries()]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export async function getGameFacets(
  gameKey: string,
  lang: string,
): Promise<GameFacets> {
  const cached = cache.get(keyOf(gameKey, lang));
  if (cached) return cached;

  const rows = await db
    .select({
      set_code: cardImageVectors.setCode,
      card_data: cardImageVectors.cardData,
    })
    .from(cardImageVectors)
    .where(
      and(
        eq(cardImageVectors.gameKey, gameKey),
        eq(cardImageVectors.lang, lang),
      ),
    );

  const bySet = new Map<string, number>();
  const rarity = new Map<string, number>();
  const types = new Map<string, number>();
  const category = new Map<string, number>();
  const stage = new Map<string, number>();
  const trainerType = new Map<string, number>();
  const weakness = new Map<string, number>();
  const illustrator = new Map<string, number>();
  const regulationMark = new Map<string, number>();

  for (const row of rows as FacetRow[]) {
    const data = (row.card_data ?? {}) as Record<string, unknown>;
    const set = (data.set ?? {}) as { id?: string };
    tally(bySet, set.id ?? row.set_code);
    tally(rarity, data.rarity);
    tally(category, data.category);
    tally(stage, data.stage);
    tally(trainerType, data.trainerType);
    tally(illustrator, data.illustrator);
    tally(regulationMark, data.regulationMark);
    for (const t of (data.types as string[] | undefined) ?? []) tally(types, t);
    for (const w of (data.weaknesses as { type?: string }[] | undefined) ?? []) {
      tally(weakness, w.type);
    }
  }

  // Group sets under their series, so a picker can offer "all of Scarlet &
  // Violet" or one set within it rather than a flat list of 218.
  const seriesMap = new Map<string, SeriesFacet>();
  for (const [setId, count] of bySet) {
    const info: SetInfo | null = getSetInfo(setId);
    const serieId = info?.serieId ?? "unknown";
    const serieName = info?.serieName ?? "Other";

    let entry = seriesMap.get(serieId);
    if (!entry) {
      const serie = getSeriesInfo(serieId);
      entry = {
        value: serieId,
        label: serieName,
        count: 0,
        logo: assetUrl(serie?.logo ?? null),
        sets: [],
      };
      seriesMap.set(serieId, entry);
    }
    entry.count += count;
    entry.sets.push({
      value: setId,
      label: info?.name ?? setId,
      count,
      serieId,
      serieName,
      symbol: assetUrl(info?.symbol ?? null),
      releaseYear: releaseYear(info),
    });
  }

  const series = [...seriesMap.values()]
    .map((s) => ({
      ...s,
      // Newest set first within a series; undated sets sink to the bottom.
      sets: s.sets.sort(
        (a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0) || a.label.localeCompare(b.label),
      ),
    }))
    .sort((a, b) => {
      const ay = Math.max(...a.sets.map((s) => s.releaseYear ?? 0));
      const by = Math.max(...b.sets.map((s) => s.releaseYear ?? 0));
      return by - ay || a.label.localeCompare(b.label);
    });

  const facets: GameFacets = {
    gameKey,
    lang,
    totalCards: rows.length,
    series,
    rarity: toFacets(rarity),
    types: toFacets(types),
    category: toFacets(category),
    stage: toFacets(stage),
    trainerType: toFacets(trainerType),
    weakness: toFacets(weakness),
    illustrator: toFacets(illustrator),
    regulationMark: toFacets(regulationMark),
    computedAt: new Date().toISOString(),
  };

  cache.set(keyOf(gameKey, lang), facets);
  return facets;
}

/** Distinct set codes present in one collection, for filtering the card grid. */
export async function getCollectionSetCodes(
  collectionId: number,
): Promise<string[]> {
  const rows = await db.execute<{ set_code: string }>(sql`
    SELECT DISTINCT card->>'set' AS set_code
    FROM collection_cards
    WHERE collection_id = ${collectionId} AND card->>'set' IS NOT NULL
    ORDER BY 1
  `);
  return rows.rows.map((r) => r.set_code);
}
