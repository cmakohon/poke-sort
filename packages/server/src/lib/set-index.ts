import indexJson from "../data/pokemon-set-index.json";

/**
 * Set and series reference data for Pokemon.
 *
 * A card's embedded `set` object has id, name and artwork but not its series,
 * and the series cannot be inferred from the set id — only 175 of 218 set ids
 * begin with their series id. Rather than a network lookup per card, the
 * mapping is generated once (scripts/build-set-index.ts) and committed, so it
 * works offline and costs nothing at scan time.
 *
 * Sets released after this file was generated simply are not found; every
 * lookup degrades to null and callers fall back to the raw set code.
 */

export interface SetInfo {
  id: string;
  name: string;
  serieId: string;
  serieName: string;
  logo: string | null;
  symbol: string | null;
  releaseDate: string | null;
  cardCount: number | null;
}

export interface SeriesInfo {
  id: string;
  name: string;
  logo: string | null;
  setCount: number;
}

const data = indexJson as unknown as {
  generatedAt: string;
  series: Record<string, SeriesInfo>;
  sets: Record<string, SetInfo>;
};

export const SET_INDEX_GENERATED_AT = data.generatedAt;

export function getSetInfo(setId: string | undefined): SetInfo | null {
  if (!setId) return null;
  return data.sets[setId] ?? null;
}

export function getSeriesInfo(serieId: string | undefined): SeriesInfo | null {
  if (!serieId) return null;
  return data.series[serieId] ?? null;
}

export function allSeries(): SeriesInfo[] {
  return Object.values(data.series);
}

export function allSets(): SetInfo[] {
  return Object.values(data.sets);
}

/** Year a set released, for "everything before 2010" style rules. */
export function releaseYear(info: SetInfo | null): number | null {
  if (!info?.releaseDate) return null;
  const year = Number(info.releaseDate.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

/**
 * TCGdex serves artwork as an extensionless base URL; the real asset needs a
 * format suffix. Proxied so the packaged app keeps a single allowlisted host.
 */
export function assetUrl(base: string | null): string | null {
  if (!base) return null;
  return `/api/cards/image-proxy?url=${encodeURIComponent(`${base}.webp`)}`;
}
