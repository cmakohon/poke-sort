import sharp, { type Sharp } from "sharp";
import { createWorker, type Worker } from "tesseract.js";
import type { OcrReading } from "@poke-sort/shared";
import { MODEL_DIR } from "../../config";
import type { OcrProfile, OcrRegion } from "./profiles";
import { probeVision, visionRecognizer, VisionUnavailable } from "./vision";

/**
 * Local OCR as a second identification signal.
 *
 * Runs server-side in the same request as the embedding so both signals arrive
 * together — a second round trip per scan would be felt on a sorter that is
 * trying to keep up with a feeder.
 *
 * Everything here is best-effort. OCR on a glare-lit webcam capture fails
 * often; the re-ranker weights it accordingly and the embedding still carries
 * the run when it does.
 */

/**
 * A small worker pool rather than one worker.
 *
 * A scan reads seven regions (plus up to four escalation retries), and on one
 * worker they serialise into the single largest cost of identification — OCR
 * p95 was 1.7s of a 2s budget. Two workers run the bands pairwise; the pool is
 * two rather than more because the embedding forward pass is competing for the
 * same cores at the same time.
 *
 * OCR_POOL_SIZE exists for eval/ocr-sweep.ts, which runs no embedding and so
 * has the cores to spare — a band sweep over the real-capture set is thousands
 * of reads and two workers make it hours. Unset in the app, deliberately: the
 * 2 above is a measured trade against the forward pass, not a default nobody
 * thought about.
 */
const POOL_SIZE = Number(process.env.OCR_POOL_SIZE) || 2;

let poolPromise: Promise<Worker[]> | null = null;
let nextWorker = 0;

async function getPool(): Promise<Worker[]> {
  if (!poolPromise) {
    poolPromise = (async () => {
      // allSettled rather than all: if one worker loads and the other fails,
      // Promise.all would abandon the live worker (leaking its thread and
      // weights) and pin poolPromise to the rejection forever — every later
      // scan silently degrading to embedding-only until restart. Terminate
      // any stray successes and null the promise so the next scan retries.
      const settled = await Promise.allSettled(
        Array.from({ length: POOL_SIZE }, () =>
          createWorker("eng", undefined, {
            // Keep the traineddata beside the other bundled model assets so
            // the packaged app never downloads it on first scan.
            ...(MODEL_DIR ? { cachePath: MODEL_DIR } : {}),
          }),
        ),
      );
      const workers = settled
        .filter((r): r is PromiseFulfilledResult<Worker> => r.status === "fulfilled")
        .map((r) => r.value);
      const failed = settled.find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      if (failed) {
        await Promise.allSettled(workers.map((w) => w.terminate()));
        poolPromise = null;
        throw failed.reason;
      }
      return workers;
    })();
  }
  return poolPromise;
}

/** Release the workers; used by tests and on shutdown. */
export async function disposeOcr(): Promise<void> {
  if (!poolPromise) return;
  const workers = await poolPromise;
  poolPromise = null;
  await Promise.all(workers.map((w) => w.terminate()));
}

/**
 * PNG bytes in, recognised text out — the only thing this module needs from an
 * OCR engine.
 *
 * A seam, not an abstraction layer: everything above it (band geometry,
 * preprocessing, the escalation ladder, the parsers) was measured against
 * Tesseract's failure modes specifically, so swapping the engine is a question
 * to be measured rather than a drop-in. eval/vision-ocr.ts implements this
 * against Apple Vision so the sweep can answer that question on real captures.
 */
export type TextRecognizer = (png: Buffer) => Promise<string>;

/** Round-robin across the Tesseract worker pool. */
export const tesseractRecognizer: TextRecognizer = async (png) => {
  // Workers hold no per-region parameters, so every worker is interchangeable
  // and reads genuinely run side by side.
  const pool = await getPool();
  const worker = pool[nextWorker++ % pool.length];
  const { data } = await worker.recognize(png);
  return data.text.trim();
};

/**
 * A recogniser plus the collector-number plan it reads best under.
 *
 * The two travel together because they are not independent: the band table
 * exists to point Tesseract at the few crops it can binarise, and handing those
 * same narrow, hard-thresholded crops to a scene-text engine throws away most
 * of what makes it better. Pairing them in one value is what stops a fallback
 * from running Vision's plan on Tesseract, which would read the whole card as
 * prose and return garbage.
 */
export interface OcrEngine {
  name: "vision" | "tesseract";
  recognize: TextRecognizer;
  plan(profile: OcrProfile): CollectorNumberPlan;
}

/**
 * One read of the entire capture, unprocessed.
 *
 * Vision finds the text itself, so there is nothing for the era-specific bands
 * to do. Measured on the 1068-capture real set this beats running Vision
 * through production's bands, 936 collector numbers to 883, on a third of the
 * reads. No escalation ladder: those four rungs are hard thresholds, which is
 * binarisation for an engine that does not binarise.
 */
export const WHOLE_CARD_PLAN: CollectorNumberPlan = {
  bands: [{ region: { x0: 0, y0: 0, x1: 1, y1: 1 }, opts: { raw: true, scale: 1 } }],
};

let enginePromise: Promise<OcrEngine> | null = null;

export const TESSERACT_ENGINE: OcrEngine = {
  name: "tesseract",
  recognize: tesseractRecognizer,
  plan: productionCollectorPlan,
};

/**
 * Vision, wrapped so that losing the sidecar costs one degraded reading rather
 * than every reading after it.
 *
 * A dead sidecar is not retried in place: the plan would still be the
 * whole-card one, and Tesseract cannot read that. Instead the cached engine is
 * cleared, this scan finishes with whatever it has (OCR is an enhancement — the
 * embedding still carries it), and the next scan re-resolves to Tesseract with
 * Tesseract's bands.
 */
export const VISION_ENGINE: OcrEngine = {
  name: "vision",
  recognize: async (png) => {
    try {
      return await visionRecognizer(png);
    } catch (err) {
      if (err instanceof VisionUnavailable) {
        console.error(`[ocr] vision lost mid-scan, reverting to Tesseract: ${err.message}`);
        enginePromise = null;
        return "";
      }
      throw err;
    }
  },
  plan: () => WHOLE_CARD_PLAN,
};

/**
 * Which engine this machine gets, decided once and remembered.
 *
 * Probed rather than assumed from `process.platform`: the sidecar is macOS
 * only, but a macOS build can still be missing it (no Swift toolchain on the
 * builder) or ship one that will not run (wrong arch, Gatekeeper). Every one of
 * those has to end in Tesseract rather than in an app that reads nothing.
 */
export function getOcrEngine(): Promise<OcrEngine> {
  if (!enginePromise) {
    enginePromise = probeVision().then((ok) => {
      console.log(`[ocr] recogniser: ${ok ? "Apple Vision" : "tesseract.js"}`);
      return ok ? VISION_ENGINE : TESSERACT_ENGINE;
    });
  }
  return enginePromise;
}

/** Test seam: forget the probed engine so the next call re-decides. */
export function resetOcrEngine(): void {
  enginePromise = null;
}

/**
 * A rescue pass for text Tesseract's own binarisation cannot separate.
 *
 * Several eras print the collector number in silver-on-holofoil (ex, neo,
 * hgss) or on a gradient footer (dp) — crops a person reads instantly but that
 * OCR returns garbage for, because adaptive binarisation smears the foil
 * texture into the glyphs. A hard threshold flattens the foil; which level
 * works depends on the card, so a short ladder is tried, both polarities.
 * Measured on the weakest-era fixtures: 2/33 plain, 20/33 with the ladder.
 */
export interface ReadOptions {
  scale?: number;
  threshold?: number;
  negate?: boolean;
  /**
   * Linear contrast stretch + sharpen instead of normalise. Won the
   * real-capture collector-number sweep (eval/ocr-sweep.ts) over normalise:
   * a webcam capture's footer is low-contrast but evenly lit, and normalise
   * lets the holo texture set the levels. Collector-number reads only —
   * name/HP bands were not measured under it.
   *
   * Re-measured 2026-08-25 on the 1068-capture real set with hgss at 97, and
   * contrast holds. A marginal count on the older hgss-thin set suggested
   * normalise was far better for that era; paired, it is not. hgss 8 -> 13
   * reads is McNemar p=0.18 (p=0.125 per distinct card), and set-wide it is
   * 269 -> 270, p=1.000 — the same reads, redistributed. Not a reason to
   * change what ships. See the grid in eval/ocr-sweep.ts.
   */
  contrast?: boolean;
  /** Sharpen after normalise. `contrast` already sharpens; this is for the other path. */
  sharpen?: boolean;
  /**
   * Extract and upscale only — no greyscale, no levels, no threshold.
   *
   * Every other option here exists to hand Tesseract something its adaptive
   * binarisation can separate. A scene-text recogniser does not binarise, so
   * for one of those the same transforms are not neutral, they are destroyed
   * information (colour is a real cue for where the digits end and the foil
   * begins). Exists for the Vision arms of eval/ocr-sweep.ts.
   */
  raw?: boolean;
}

async function readRegion(
  image: Sharp,
  width: number,
  height: number,
  region: OcrRegion,
  opts: ReadOptions = {},
  recognize: TextRecognizer = tesseractRecognizer,
): Promise<string> {
  const left = Math.max(0, Math.round(region.x0 * width));
  const top = Math.max(0, Math.round(region.y0 * height));
  const cropWidth = Math.min(width - left, Math.round((region.x1 - region.x0) * width));
  const cropHeight = Math.min(height - top, Math.round((region.y1 - region.y0) * height));
  if (cropWidth <= 0 || cropHeight <= 0) return "";

  // Upscale, greyscale and stretch: card text is small in the frame and
  // Tesseract is markedly better on a larger, high-contrast crop.
  let pipeline = image
    .clone()
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize({ width: cropWidth * (opts.scale ?? (opts.contrast ? 4 : 3)) });
  if (!opts.raw) {
    pipeline = pipeline.greyscale();
    pipeline = opts.contrast
      ? pipeline.linear(1.35, -35).sharpen()
      : opts.sharpen
        ? pipeline.normalise().sharpen()
        : pipeline.normalise();
    if (opts.threshold != null) pipeline = pipeline.threshold(opts.threshold);
    if (opts.negate) pipeline = pipeline.negate();
  }

  const buffer = await pipeline
    // Tesseract warns and guesses when the DPI is implausible; the upscale
    // above makes 300 the honest figure.
    .withMetadata({ density: 300 })
    .png()
    .toBuffer();

  return recognize(buffer);
}

/**
 * The escalation ladder, cheapest first. Only run when the plain pass parsed
 * no fraction at all — the card was headed to review anyway, so a couple of
 * extra reads to rescue it is the cheap side of the trade.
 */
export const ESCALATION: ReadOptions[] = [
  { scale: 4, threshold: 100 },
  { scale: 4, threshold: 125 },
  { scale: 4, threshold: 145 },
  { scale: 4, threshold: 100, negate: true },
];

/**
 * Which crops to read for the collector number, and how.
 *
 * Every band carries its own ReadOptions rather than the whole list sharing
 * one preprocessing setting: the bands already encode era-specific geometry
 * (see POKEMON_OCR.collectorNumber), so per-band preprocessing is the only way
 * to say "the band where hgss prints its number wants different treatment"
 * without detecting the era first — which is not knowable at scan time.
 *
 * eval/ocr-sweep.ts builds these directly, which is the point: the sweep used
 * to keep its own copy of the preprocessing and of the band-reduction loop, so
 * it measured a pipeline production does not run.
 */
export interface CollectorNumberPlan {
  bands: { region: OcrRegion; opts?: ReadOptions }[];
  /**
   * Retried, cheapest rung first, only when no band parsed a full fraction.
   * Absent means no rescue pass.
   */
  escalation?: { region: OcrRegion; ladder: ReadOptions[] };
}

/** Exactly what the live pipeline reads. The sweep's baseline arm. */
export function productionCollectorPlan(
  profile: OcrProfile,
): CollectorNumberPlan {
  const bands = profile.collectorNumber.map((region) => ({
    region,
    opts: { contrast: true } as ReadOptions,
  }));
  const deepRight = profile.collectorNumber[0];
  return {
    bands,
    // The dark-footer eras (ex, neo, hgss, dp) defeat plain binarisation, and
    // the deep-right band is where all of them print the number. Except hgss,
    // where the band clips the tops of the digits: on 97 labelled hgss
    // captures it reads 1-2 and the ladder rescues 0.
    //
    // A taller right band (y .90-1.0) fixes that and was REJECTED anyway,
    // measured end to end on 2026-08-25. It is a big, real read gain — 269 ->
    // 290 set-wide, McNemar p<0.001 — and it costs two false accepts:
    // dp2-113 -> dp3-120 and ex13-54 -> bw7-98. The first is the same card
    // that killed the seam band in 5526f2e, found again from scratch. The
    // trade is +7 accepts for 2 mis-sorts, and false accepts are a constraint
    // here, not a term. Do not re-litigate this without new evidence about
    // telling a garbled read from a clean one.
    //
    // ⚠ CORRECTION, 2026-08-27: NEITHER was a false accept. Both fixtures are
    // mislabeled and the band read both correctly — dp2-113 is Night
    // Maintenance 120/132 (dp3-120), ex13-54 is Vibrava 98/149 (bw7-98), each
    // confirmed by opening the capture. "The same card, found again from
    // scratch" was the same bad LABEL found twice. This rejection has no
    // surviving evidence behind it and the band is owed a fresh measurement
    // once the labels are fixed. See docs/vision-ocr-evaluation.md.
    escalation: deepRight ? { region: deepRight, ladder: ESCALATION } : undefined,
  };
}

/**
 * Largest plausible printed denominator. The catalog's biggest set is 307, so
 * this leaves headroom while still rejecting the three-digit garbage OCR reads
 * out of the copyright line ("901", "716", "710") and the dropped-digit "000".
 */
const MAX_SET_TOTAL = 400;

/** "58/102" -> {58, 102}; also accepts "058/102" and spaced variants. */
export function parseCollectorNumber(
  text: string,
): { collectorNumber: string; setTotal?: number } | null {
  const fraction = /(\d{1,3})\s*\/\s*(\d{1,3})/.exec(text);
  if (fraction) {
    const total = Number(fraction[2]);
    // An impossible denominator means the "fraction" is noise that happened to
    // straddle a slash, so the numerator beside it is not trustworthy either.
    // Reporting setTotal anyway did real damage: it is the flag that says "a
    // full number was read", so it both overwrote a better collectorNumber and
    // suppressed the escalation retry that exists to recover one. Returning it
    // without a setTotal keeps the weak reading as a fallback while letting
    // escalation run. Same plausibility guard parseHp already applies.
    if (total >= 1 && total <= MAX_SET_TOTAL) {
      return {
        collectorNumber: fraction[1].replace(/^0+(?=\d)/, ""),
        setTotal: total,
      };
    }
    return { collectorNumber: fraction[1].replace(/^0+(?=\d)/, "") };
  }
  // Below here there is no denominator to corroborate the reading, so both
  // patterns are deliberately narrow.
  //
  // They used to be wide enough to match almost any noise: across 93 labelled
  // real captures they fired 26 times and were correct 0 times, pulling
  // fragments like "EO 2", "BIN 0" and "RAFT 4" out of the copyright line. A
  // number with no denominator still scores half credit in
  // collectorNumberMatch, so each one handed an arbitrary same-numbered
  // candidate a boost it had not earned.
  //
  // Every promo the catalog actually prints has 2+ digits — BW01, SWSH001,
  // HGSS01, XY01 — and the bare form (svp's "001") is always zero-padded.
  // Requiring that costs nothing real and drops the wrong readings from 34 to
  // 14 without losing a single correct one.
  const promo = /\b([A-Z]{2,4})\s*[- ]?\s*(\d{2,3})\b/.exec(text.toUpperCase());
  if (promo) return { collectorNumber: promo[2].replace(/^0+(?=\d)/, "") };

  const bare = /\b(0\d{1,2})\b/.exec(text);
  return bare ? { collectorNumber: bare[1].replace(/^0+(?=\d)/, "") } : null;
}

export function parseHp(text: string): number | undefined {
  const match = /(\d{2,3})/.exec(text.replace(/HP/gi, " "));
  if (!match) return undefined;
  const hp = Number(match[1]);
  // Printed HP is a multiple of 10, from 30 to 340.
  return hp >= 30 && hp <= 400 && hp % 10 === 0 ? hp : undefined;
}

function cleanName(text: string): string | undefined {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0];
  if (!line) return undefined;
  // Strip the HP that often bleeds in from the right of the name band.
  const stripped = line.replace(/\b\d{2,3}\s*HP\b/gi, "").trim();
  return stripped.length >= 3 ? stripped : undefined;
}

/**
 * Reads every band in the plan and keeps the best-formed parse, rather than
 * trying to detect the card's era first. Era detection is itself a guess, and
 * a wrong guess costs the signal entirely.
 *
 * Exported so eval/ocr-sweep.ts measures this exact code rather than a copy of
 * it. The copy had already drifted: the sweep chose bands under 3x-normalise
 * while production read them under 4x-contrast-sharpen, and it had no
 * escalation pass at all.
 */
export async function readCollectorNumber(
  image: Sharp,
  width: number,
  height: number,
  plan: CollectorNumberPlan,
  recognize: TextRecognizer = tesseractRecognizer,
): Promise<Pick<OcrReading, "collectorNumber" | "setTotal" | "collectorNumberRaw">> {
  const reading: Pick<
    OcrReading,
    "collectorNumber" | "setTotal" | "collectorNumberRaw"
  > = {};
  const texts = await Promise.all(
    plan.bands.map((b) =>
      readRegion(image, width, height, b.region, b.opts, recognize),
    ),
  );

  // Prefer a reading that includes the denominator — it is worth double. The
  // raw text is kept regardless: candidates are matched against it directly,
  // which tolerates the stray marks OCR adds around the number.
  const rawReadings: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    rawReadings.push(text);
    const parsed = parseCollectorNumber(text);
    if (!parsed) continue;
    if (parsed.setTotal != null && reading.setTotal == null) {
      reading.collectorNumber = parsed.collectorNumber;
      reading.setTotal = parsed.setTotal;
    } else {
      reading.collectorNumber ??= parsed.collectorNumber;
    }
  }

  // Escalate only when nothing parsed as a full fraction: the card was headed
  // to review anyway, so a couple of extra reads to rescue it is the cheap
  // side of the trade.
  if (reading.setTotal == null && plan.escalation) {
    const { region, ladder } = plan.escalation;
    // Pairwise, matching the pool width: latency of ceil(4/2) reads, and the
    // second pair is skipped entirely when the first finds a parse.
    for (let i = 0; i < ladder.length; i += 2) {
      const rung = await Promise.all(
        ladder
          .slice(i, i + 2)
          .map((opts) => readRegion(image, width, height, region, opts, recognize)),
      );
      let found = false;
      for (const text of rung) {
        if (!text) continue;
        const parsed = parseCollectorNumber(text);
        if (parsed?.setTotal != null) {
          rawReadings.push(text);
          reading.collectorNumber = parsed.collectorNumber;
          reading.setTotal = parsed.setTotal;
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }

  if (rawReadings.length > 0) reading.collectorNumberRaw = rawReadings.join(" ");
  return reading;
}

/**
 * What the live pipeline calls: read this capture with whichever engine this
 * machine actually has.
 *
 * Kept separate from `readCard` so the eval harness keeps naming its recogniser
 * and plan explicitly — a sweep arm that silently became Vision on macOS would
 * report a baseline that is not the baseline.
 */
export async function readCardWithBestEngine(
  imageBuffer: Buffer,
  profile: OcrProfile,
): Promise<OcrReading> {
  const engine = await getOcrEngine();
  return readCard(imageBuffer, profile, engine.recognize, engine.plan(profile));
}

/**
 * Name, collector number and HP from one capture, all bands in parallel.
 *
 * `recognize` and `plan` are seams for the eval harness, which measures
 * alternative engines end to end. Both default to Tesseract's behaviour, so a
 * caller that names neither gets exactly what shipped before Vision existed.
 */
export async function readCard(
  imageBuffer: Buffer,
  profile: OcrProfile,
  recognize: TextRecognizer = tesseractRecognizer,
  plan?: CollectorNumberPlan,
): Promise<OcrReading> {
  const image = sharp(imageBuffer);
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return {};

  const reading: OcrReading = {};

  // Every plain region is queued at once and drained by the pool: which crop
  // holds which fact is not knowable in advance, so nothing is gained by
  // reading them in a clever order and everything by reading them in parallel.
  const [nameTexts, number, hpTexts] = await Promise.all([
    Promise.all(
      profile.name.map((r) => readRegion(image, width, height, r, {}, recognize)),
    ),
    readCollectorNumber(
      image,
      width,
      height,
      plan ?? productionCollectorPlan(profile),
      recognize,
    ),
    Promise.all(
      profile.hp.map((r) => readRegion(image, width, height, r, {}, recognize)),
    ),
  ]);
  Object.assign(reading, number);

  for (const text of nameTexts) {
    const name = cleanName(text);
    if (name) {
      reading.name = name;
      break;
    }
  }

  for (const text of hpTexts) {
    const hp = parseHp(text);
    if (hp != null) {
      reading.hp = hp;
      break;
    }
  }

  return reading;
}
