import sharp from "sharp";
import { getSetInfo } from "./set-index";
import type { OcrRegion } from "./identify/profiles";

/**
 * The art window: which part of a card gets its own embedding.
 *
 * SigLIP sees a whole card at 512px, where the art is ~220px and the frame —
 * identical across every card in a set — dominates. Two printings of one
 * Pokemon with different art land ~0.02 apart, inside the margin gate. That is
 * the single largest cause of HS-era misidentification (top-1 74.2% against
 * pl/dp/bw at ~98.6%); see docs/hgss-identification-accuracy.md.
 *
 * Cropping to the art and embedding that separately gives a second, weakly
 * correlated view. It is not better on its own — it trades pl/dp/bw accuracy
 * for hgss and lands in the same place overall — but blended with the
 * whole-card distance it beats either alone.
 */

/**
 * Bump when any window below changes.
 *
 * Stored art vectors are only comparable to a query cropped the same way, and
 * a changed window degrades every match without failing anything — exactly the
 * silent breakage `embedding-identity.ts` exists to catch. It is checked there
 * on pack import.
 */
export const ART_WINDOW_VERSION = 1;

/**
 * The window measured for dp/hgss/pl/bw by cropping renders and looking, then
 * confirmed to carry the whole-set result: the probe that produced the 93.8%
 * hgss figure applied this to every card in the pool, not just those four
 * eras, so this is the geometry that number was earned under.
 */
const FRAMED: OcrRegion = { x0: 0.06, y0: 0.12, x1: 0.94, y1: 0.55 };

/**
 * Series -> window, or null for "no art view; score this card on the whole
 * card alone".
 *
 * Keyed on serieId rather than the set code because the series is not
 * derivable from the set id — only 175 of 218 ids begin with it (see
 * set-index.ts). Adding a refined window for an era is a line here, a
 * ART_WINDOW_VERSION bump and a re-embed of that series.
 *
 * Every framed series shares FRAMED today. That is deliberate rather than
 * lazy: a null entry is NOT free. `(1-w)*d + w*d == d`, so a card without an
 * art vector is scored on a different scale than one with it, and a typical
 * 50-candidate set spans 8-17 series — for 42 of 97 labelled hgss captures the
 * deciding rival is from another series. Gaps in this table put the truth and
 * the card it must beat on different scales in the common case.
 */
const WINDOW_BY_SERIES: Record<string, OcrRegion | null> = {
  misc: FRAMED,
  base: FRAMED,
  gym: FRAMED,
  neo: FRAMED,
  lc: FRAMED,
  ecard: FRAMED,
  ex: FRAMED,
  pop: FRAMED,
  tk: FRAMED,
  dp: FRAMED,
  pl: FRAMED,
  hgss: FRAMED,
  col: FRAMED,
  bw: FRAMED,
  mc: FRAMED,
  xy: FRAMED,
  sm: FRAMED,
  swsh: FRAMED,
  sv: FRAMED,
  // Pokemon TCG Pocket is digital-only and already dropped at candidate time
  // (profiles.ts excludedSetIds), so embedding it would cost pack bytes for
  // cards a physical capture can never match.
  tcgp: null,
  me: FRAMED,
};

/** The window a card from this series is cropped to, null for whole-card only. */
export function artWindowFor(serieId: string | null | undefined): OcrRegion | null {
  if (!serieId) return null;
  return WINDOW_BY_SERIES[serieId] ?? null;
}

/**
 * The window a card from this set is cropped to.
 *
 * Goes through the set index rather than pattern-matching the set code: the
 * series is not derivable from the set id, only 175 of 218 ids begin with it.
 * An unknown set degrades to null and is scored on the whole card.
 */
export function artWindowForSet(setId: string | null | undefined): OcrRegion | null {
  return artWindowFor(getSetInfo(setId ?? undefined)?.serieId);
}

/** Stable identity for a window, so equal geometry shares one forward pass. */
export function artWindowKey(window: OcrRegion): string {
  return `${window.x0},${window.y0},${window.x1},${window.y1}`;
}

/**
 * The distinct windows the table can ask for.
 *
 * The capture's era is not knowable at scan time, so the query is embedded
 * once per distinct window and each candidate is compared under its own
 * series' geometry. One window today means one extra forward pass.
 */
export function distinctArtWindows(): { key: string; window: OcrRegion }[] {
  const seen = new Map<string, OcrRegion>();
  for (const window of Object.values(WINDOW_BY_SERIES)) {
    if (window) seen.set(artWindowKey(window), window);
  }
  return [...seen].map(([key, window]) => ({ key, window }));
}

/** Crop to the window, as fractions of whatever the image happens to be. */
export async function cropArt(buffer: Buffer, window: OcrRegion): Promise<Buffer> {
  const png = await sharp(buffer).png().toBuffer();
  const { width, height } = await sharp(png).metadata();
  if (!width || !height) throw new Error("art crop: image has no dimensions");
  return sharp(png)
    .extract({
      left: Math.round(window.x0 * width),
      top: Math.round(window.y0 * height),
      width: Math.round((window.x1 - window.x0) * width),
      height: Math.round((window.y1 - window.y0) * height),
    })
    .png()
    .toBuffer();
}
