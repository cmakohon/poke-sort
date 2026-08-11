import sharp from "sharp";

/**
 * 1st Edition stamp detection for WOTC-frame cards.
 *
 * The stamp is a dark "EDITION ①" mark printed mid-left, just below the art
 * frame — the one place on the classic layout that is otherwise plain card
 * frame. Detection is dark-blob statistics inside that window, entirely
 * self-contained on the capture: no network, no reference render, so it works
 * offline like the rest of identification.
 *
 * Only meaningful for cards whose TCGdex variants include firstEdition, which
 * is exactly the classic-frame sets (base1/2/3/5, gym1/2, neo1-4). Callers
 * gate on that; the e-card layout, whose art extends into this window, never
 * reaches the detector because its sets had no English 1st Editions.
 *
 * Thresholds were set against labeled fixture renders (TCGdex's WOTC scans are
 * themselves 1st Edition copies, giving real positives) and validated with the
 * stamp composited onto unstamped same-frame renders — see eval/stamp.test.ts,
 * whose labels hold by construction: Base Set 2 and the Wizards promos never
 * had 1st Edition printings, so their renders cannot be stamped.
 *
 * ⚠ Real captures add glare and shadow this has not seen. The compactness
 * bound exists for exactly that: a shadow band is spread out where a stamp is
 * a tight disc. Treat the verdict as a strong default for the variant field,
 * not ground truth.
 */

/**
 * Window that contains the stamp across base/gym/neo layouts. The bottom stops
 * above the energy-cost symbols (y~.60) and the top stops below most of the
 * art frame's shadow, both of which are dark, compact, and not stamps.
 */
const ROI = { x0: 0.03, y0: 0.505, x1: 0.17, y1: 0.585 };

/**
 * Contrast depth: how far the 3rd percentile sits below the median. A plain
 * frame is unimodal (depth 20-60 even with degradation); ink adds a distinct
 * dark mode (observed 100-160 real, 90+ composited). Depth is anchor-free —
 * unlike a fixed offset from the median it does not care how dark the frame
 * itself is, which is what broke the previous version on dim captures.
 */
const DEPTH_MIN = 80;

/** Observed stamped range with margin; outside it the blob is not a stamp. */
const DARK_FRAC_MIN = 0.06;
const DARK_FRAC_MAX = 0.4;

/** A stamp is compact; shadows and edges smear. RMS radius / ROI diagonal. */
const SPREAD_MAX = 0.3;

/**
 * Where the dark mass must sit. The stamp prints centre-left; the dark things
 * that are NOT stamps — the art frame's corner shadow, edge bleed — hug the
 * right and the extremes of the window.
 */
const CENTROID_X_MAX = 0.68;
const CENTROID_Y_MIN = 0.12;
const CENTROID_Y_MAX = 0.88;

export interface StampReading {
  stamped: boolean;
  /** median - p3, grey levels: the strength of the dark mode. */
  depth: number;
  /** Fraction of ROI pixels below the midpoint of median and p3. */
  darkFrac: number;
  /** RMS distance of dark pixels from their centroid over the ROI diagonal. */
  spread: number;
}

export async function detectFirstEditionStamp(
  imageBuffer: Buffer,
): Promise<StampReading> {
  const image = sharp(imageBuffer);
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return { stamped: false, depth: 0, darkFrac: 0, spread: 1 };

  const left = Math.round(ROI.x0 * width);
  const top = Math.round(ROI.y0 * height);
  const w = Math.min(width - left, Math.round((ROI.x1 - ROI.x0) * width));
  const h = Math.min(height - top, Math.round((ROI.y1 - ROI.y0) * height));
  if (w <= 0 || h <= 0) return { stamped: false, depth: 0, darkFrac: 0, spread: 1 };

  const { data, info } = await image
    .extract({ left, top, width: w, height: h })
    .greyscale()
    // Deliberately NOT normalised: stretching a uniform frame's noise to full
    // range makes half its pixels read as "dark". The percentile statistics
    // below are exposure-relative without inventing contrast that isn't there.
    .raw()
    .toBuffer({ resolveWithObject: true });

  const sorted = Array.from(data).sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.floor(sorted.length * f)];
  const median = q(0.5);
  const p3 = q(0.03);
  const depth = median - p3;
  const cut = (median + p3) / 2;

  let dark = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] < cut) {
        dark++;
        sumX += x;
        sumY += y;
      }
    }
  }
  const total = info.width * info.height;
  const darkFrac = dark / total;

  let spread = 1;
  let cxFrac = 1;
  let cyFrac = 0;
  if (dark > 30) {
    const cx = sumX / dark;
    const cy = sumY / dark;
    cxFrac = cx / info.width;
    cyFrac = cy / info.height;
    let sq = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (data[y * info.width + x] < cut) {
          sq += (x - cx) ** 2 + (y - cy) ** 2;
        }
      }
    }
    spread =
      Math.sqrt(sq / dark) /
      Math.sqrt(info.width ** 2 + info.height ** 2);
  }

  return {
    stamped:
      depth >= DEPTH_MIN &&
      darkFrac >= DARK_FRAC_MIN &&
      darkFrac <= DARK_FRAC_MAX &&
      spread <= SPREAD_MAX &&
      cxFrac <= CENTROID_X_MAX &&
      cyFrac >= CENTROID_Y_MIN &&
      cyFrac <= CENTROID_Y_MAX,
    depth,
    darkFrac,
    spread,
  };
}

/** Whether this card has a 1st Edition printing at all (the detector's gate). */
export function hasFirstEditionVariant(cardData: unknown): boolean {
  if (!cardData || typeof cardData !== "object") return false;
  const variants = (cardData as { variants?: { firstEdition?: unknown } }).variants;
  return variants?.firstEdition === true;
}
