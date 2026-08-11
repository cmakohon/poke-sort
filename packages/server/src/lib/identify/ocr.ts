import sharp, { type Sharp } from "sharp";
import { createWorker, type Worker } from "tesseract.js";
import type { OcrReading } from "@poke-sort/shared";
import { MODEL_DIR } from "../../config";
import type { OcrProfile, OcrRegion } from "./profiles";

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
 */
const POOL_SIZE = 2;

let poolPromise: Promise<Worker[]> | null = null;
let nextWorker = 0;

async function getPool(): Promise<Worker[]> {
  if (!poolPromise) {
    poolPromise = Promise.all(
      Array.from({ length: POOL_SIZE }, () =>
        createWorker("eng", undefined, {
          // Keep the traineddata beside the other bundled model assets so the
          // packaged app never downloads it on first scan.
          ...(MODEL_DIR ? { cachePath: MODEL_DIR } : {}),
        }),
      ),
    );
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
 * A rescue pass for text Tesseract's own binarisation cannot separate.
 *
 * Several eras print the collector number in silver-on-holofoil (ex, neo,
 * hgss) or on a gradient footer (dp) — crops a person reads instantly but that
 * OCR returns garbage for, because adaptive binarisation smears the foil
 * texture into the glyphs. A hard threshold flattens the foil; which level
 * works depends on the card, so a short ladder is tried, both polarities.
 * Measured on the weakest-era fixtures: 2/33 plain, 20/33 with the ladder.
 */
interface ReadOptions {
  scale?: number;
  threshold?: number;
  negate?: boolean;
}

async function readRegion(
  image: Sharp,
  width: number,
  height: number,
  region: OcrRegion,
  opts: ReadOptions = {},
): Promise<string> {
  const left = Math.max(0, Math.round(region.x0 * width));
  const top = Math.max(0, Math.round(region.y0 * height));
  const cropWidth = Math.min(width - left, Math.round((region.x1 - region.x0) * width));
  const cropHeight = Math.min(height - top, Math.round((region.y1 - region.y0) * height));
  if (cropWidth <= 0 || cropHeight <= 0) return "";

  // Upscale, greyscale and normalise: card text is small in the frame and
  // Tesseract is markedly better on a larger, high-contrast crop.
  let pipeline = image
    .clone()
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize({ width: cropWidth * (opts.scale ?? 3) })
    .greyscale()
    .normalise();
  if (opts.threshold != null) pipeline = pipeline.threshold(opts.threshold);
  if (opts.negate) pipeline = pipeline.negate();

  const buffer = await pipeline
    // Tesseract warns and guesses when the DPI is implausible; the upscale
    // above makes 300 the honest figure.
    .withMetadata({ density: 300 })
    .png()
    .toBuffer();

  // Round-robin across the pool. Workers hold no per-region parameters, so
  // every worker is interchangeable and reads genuinely run side by side.
  const pool = await getPool();
  const worker = pool[nextWorker++ % pool.length];
  const { data } = await worker.recognize(buffer);
  return data.text.trim();
}

/**
 * The escalation ladder, cheapest first. Only run when the plain pass parsed
 * no fraction at all — the card was headed to review anyway, so a couple of
 * extra reads to rescue it is the cheap side of the trade.
 */
const ESCALATION: ReadOptions[] = [
  { scale: 4, threshold: 100 },
  { scale: 4, threshold: 125 },
  { scale: 4, threshold: 145 },
  { scale: 4, threshold: 100, negate: true },
];

/** "58/102" -> {58, 102}; also accepts "058/102" and spaced variants. */
export function parseCollectorNumber(
  text: string,
): { collectorNumber: string; setTotal?: number } | null {
  const fraction = /(\d{1,3})\s*\/\s*(\d{1,3})/.exec(text);
  if (fraction) {
    return {
      collectorNumber: fraction[1].replace(/^0+(?=\d)/, ""),
      setTotal: Number(fraction[2]),
    };
  }
  // SV-era promos: "SVP 001", "GG01". No denominator is printed.
  const promo = /\b([A-Z]{2,4})\s*[- ]?\s*(\d{1,3})\b/.exec(text.toUpperCase());
  if (promo) return { collectorNumber: promo[2].replace(/^0+(?=\d)/, "") };

  const bare = /\b(\d{1,3})\b/.exec(text);
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
 * Reads every region in the profile and keeps the best-formed parse, rather
 * than trying to detect the card's era first. Era detection is itself a guess,
 * and a wrong guess costs the signal entirely.
 */
export async function readCard(
  imageBuffer: Buffer,
  profile: OcrProfile,
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
  const [nameTexts, numberTexts, hpTexts] = await Promise.all([
    Promise.all(profile.name.map((r) => readRegion(image, width, height, r))),
    Promise.all(
      profile.collectorNumber.map((r) => readRegion(image, width, height, r)),
    ),
    Promise.all(profile.hp.map((r) => readRegion(image, width, height, r))),
  ]);

  for (const text of nameTexts) {
    const name = cleanName(text);
    if (name) {
      reading.name = name;
      break;
    }
  }

  // Prefer a reading that includes the denominator — it is worth double. The
  // raw text is kept regardless: candidates are matched against it directly,
  // which tolerates the stray marks OCR adds around the number.
  const rawReadings: string[] = [];
  for (const text of numberTexts) {
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
  // Escalate only when nothing parsed as a full fraction: the dark-footer
  // eras (ex, neo, hgss, dp) defeat plain binarisation, and the deep-right
  // band is where all of them print the number.
  if (reading.setTotal == null) {
    const deepRight = profile.collectorNumber[0];
    // Pairwise, matching the pool width: latency of ceil(4/2) reads, and the
    // second pair is skipped entirely when the first finds a parse.
    for (let i = 0; i < ESCALATION.length; i += 2) {
      const texts = await Promise.all(
        ESCALATION.slice(i, i + 2).map((opts) =>
          readRegion(image, width, height, deepRight, opts),
        ),
      );
      let found = false;
      for (const text of texts) {
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

  for (const text of hpTexts) {
    const hp = parseHp(text);
    if (hp != null) {
      reading.hp = hp;
      break;
    }
  }

  return reading;
}
