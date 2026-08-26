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
  /** Printed beside the collector number from Sword & Shield onward. */
  abbreviation: string | null;
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

/**
 * Sets that exist only as digital renders — Pokemon TCG Pocket.
 *
 * A physical sorter can never scan one, but the catalog carries them (1,649
 * cards) and most share their art with a physical printing. To the embedding
 * they are near-perfect twins: 89 of 134 physical eval probes had a Pocket
 * card among their ten nearest neighbours, and two had one as THE nearest.
 * Identification excludes them; search and the catalog keep them.
 */
export function digitalOnlySetIds(): string[] {
  return Object.values(data.sets)
    .filter((s) => s.serieId === "tcgp")
    .map((s) => s.id);
}

/**
 * Whether a denominator OCR read off a card footer — the 123 of "67/123" — is
 * solid enough to argue AGAINST a candidate that prints a different one.
 *
 * That is a deliberately higher bar than "some set has this many cards", and
 * the asymmetry is the point. A denominator that AGREES with a candidate is
 * checked by equality and needs no help from here; this gate only guards the
 * negative inference, where being wrong is expensive: `collectorNumberMatch`
 * takes a correctly-read numerator from half credit to zero on the strength of
 * it. Across the 956 labelled real captures that branch fires 43 times with
 * the numerator right.
 *
 * Two tests, because either alone lets the real failures through:
 *
 *  - Membership. The catalog's own totals would do, but the index is the
 *    better source: it covers 56 sets not synced locally (so a later sync
 *    cannot silently change behaviour) and it keeps this callable from
 *    eval/tune.ts, which has no database. Verified equal to `cards.set_total`
 *    on all 162 sets the two share — both are tcgdex `cardCount.official`,
 *    which is the number that gets printed.
 *
 *  - A floor, and this is the one that actually does the work. The garbled
 *    denominators in the labelled set are almost all fragments of the real
 *    fraction — "1" sixteen times, "11" six, then 10, 9, 7, 5, 4, 3, 14.
 *    Membership does not catch them, because the index carries oddities whose
 *    cardCount genuinely IS 1, 5, 7, 9, 10, 11.
 *
 * 15 is where those two groups separate, and the set list supports the cut
 * independently: every set below 15 cards is a trainer kit, a sample sheet, an
 * energy pack or a McDonald's insert — products that do not turn up in a bulk
 * sorting pile — while 15 and up is Rumble, POP Series, Southern Islands,
 * Dragon Vault, real things people sort. It is still a line drawn through 43
 * observed cases, so treat it as calibrated rather than derived, and re-check
 * it when the labelled set grows.
 *
 * The floor costs little it should not: a small set read CORRECTLY still gets
 * full credit from the equality branch in collectorNumberMatch, which runs
 * first. All this decides is whether a disagreeing denominator counts as proof
 * against a candidate, and "/1" should not.
 */
const MIN_TRUSTWORTHY_TOTAL = 15;

let setTotals: Set<number> | null = null;
export function isTrustworthySetTotal(total: number): boolean {
  if (total < MIN_TRUSTWORTHY_TOTAL) return false;
  if (!setTotals) {
    setTotals = new Set(
      Object.values(data.sets)
        .map((s) => s.cardCount)
        .filter((c): c is number => c != null && c > 0),
    );
  }
  return setTotals.has(total);
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
