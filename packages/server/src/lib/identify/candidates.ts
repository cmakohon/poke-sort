import type { CatalogCardRow } from "../catalog-card";
import { artWindowForSet } from "../art-window";
import { getSetInfo } from "../set-index";
import type { OcrRegion } from "./profiles";
import type { RerankInput } from "./rerank";

/**
 * Shaping a catalog row into what the reranker sees.
 *
 * Deliberately free of any database import. `identify/index.ts` opens PGlite at
 * module load — it constructs the client and takes the data-directory lock — so
 * anything that reaches it transitively cannot be unit-tested without a
 * database. `eval/rerank.test.ts` is pure logic and used to pull all of that in
 * through one import, which meant `pnpm test` acquired the dev data dir and
 * failed outright when the app was running.
 */
export interface CandidateRow extends CatalogCardRow {
  distance: number;
  set_total: number | null;
  /** Null when the catalog has no art vector for this card. */
  art_distance?: number | null;
}

/**
 * The card's set id.
 *
 * Prefers the embedded set object over `set_code`: the sync derives the two
 * differently (`id.split("-")[0]` on the list endpoint, `set.id` on the detail
 * one) and they disagree for 38 of 21,714 catalog rows.
 *
 * Every caller that resolves an art window MUST go through this, on both the
 * read and the write side. Storing a vector cropped to the window for
 * `set_code` and later comparing it against a query cropped to the window for
 * `set.id` would compare two different geometries and produce a plausible,
 * wrong distance — worse than having no vector at all, because a null degrades
 * to whole-card scoring while a mismatch does not announce itself.
 */
export function setIdOf(row: {
  set_code: string;
  card_data?: unknown;
}): string {
  return (
    ((row.card_data as { set?: { id?: string } } | null)?.set?.id) ??
    row.set_code
  );
}

/** The art window this row's card was, or should be, cropped to. */
export function artWindowForRow(row: {
  set_code: string;
  card_data?: unknown;
}): OcrRegion | null {
  return artWindowForSet(setIdOf(row));
}

// Set codes are only printed on the card from Sword & Shield (2020-02) onward.
// The set index carries an abbreviation for almost every set regardless — for
// the 132 older ones it is a PTCGO code (dp6 "LA", pl2 "RR"...) that never
// appears on the physical card, and matching those against the OCR'd bottom
// band handed wrong reprints a signal the true card could not earn: 6 of the
// 20 mis-identifications in the first 596 labelled production scans were
// two-letter PTCGO codes false-matching OCR garble.
const FIRST_PRINTED_SET_CODE = "2020-02";

/** The candidate set's printed code, from the local set index. */
export function abbreviationOf(
  gameKey: string,
  row: CandidateRow,
): string | null {
  if (gameKey !== "pokemon") return null;
  const info = getSetInfo(setIdOf(row));
  if (!info?.releaseDate || info.releaseDate < FIRST_PRINTED_SET_CODE) {
    return null;
  }
  return info.abbreviation ?? null;
}

export function hpOf(gameKey: string, data: unknown): number | null {
  if (gameKey !== "pokemon" || !data || typeof data !== "object") return null;
  const hp = (data as { hp?: unknown }).hp;
  return typeof hp === "number" ? hp : null;
}

/**
 * The rerank view of a candidate row. Shared between the live pipeline and the
 * eval capture script, so the two can never drift apart on what a candidate
 * looks like to the fusion.
 */
export function buildRerankInputs(
  rows: CandidateRow[],
  gameKey: string,
): RerankInput[] {
  return rows.map((row) => ({
    id: row.card_id,
    distance: row.distance,
    name: row.name,
    collectorNumber: row.collector_number,
    setTotal: row.set_total,
    hp: hpOf(gameKey, row.card_data),
    setAbbreviation: abbreviationOf(gameKey, row),
    artDistance: row.art_distance ?? null,
  }));
}
