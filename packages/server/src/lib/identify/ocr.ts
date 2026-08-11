import sharp, { type Sharp } from "sharp";
import { createWorker, type Worker } from "tesseract.js";
import type { OcrReading } from "@magic-vault/shared";
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

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng", undefined, {
      // Keep the traineddata beside the other bundled model assets so the
      // packaged app never downloads it on first scan.
      ...(MODEL_DIR ? { cachePath: MODEL_DIR } : {}),
    });
  }
  return workerPromise;
}

/** Release the worker; used by tests and on shutdown. */
export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}

async function readRegion(
  image: Sharp,
  width: number,
  height: number,
  region: OcrRegion,
): Promise<string> {
  const left = Math.max(0, Math.round(region.x0 * width));
  const top = Math.max(0, Math.round(region.y0 * height));
  const cropWidth = Math.min(width - left, Math.round((region.x1 - region.x0) * width));
  const cropHeight = Math.min(height - top, Math.round((region.y1 - region.y0) * height));
  if (cropWidth <= 0 || cropHeight <= 0) return "";

  const buffer = await image
    .clone()
    .extract({ left, top, width: cropWidth, height: cropHeight })
    // Upscale, greyscale and normalise: card text is small in the frame and
    // Tesseract is markedly better on a larger, high-contrast crop.
    .resize({ width: cropWidth * 3 })
    .greyscale()
    .normalise()
    // Tesseract warns and guesses when the DPI is implausible; the upscale
    // above makes 300 the honest figure.
    .withMetadata({ density: 300 })
    .png()
    .toBuffer();

  const worker = await getWorker();
  await worker.setParameters({
    tessedit_char_whitelist: region.charset ?? "",
  });
  const { data } = await worker.recognize(buffer);
  return data.text.trim();
}

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

  for (const region of profile.name) {
    const name = cleanName(await readRegion(image, width, height, region));
    if (name) {
      reading.name = name;
      break;
    }
  }

  // Prefer a reading that includes the denominator — it is worth double. The
  // raw text is kept regardless: candidates are matched against it directly,
  // which tolerates the stray marks OCR adds around the number.
  const rawReadings: string[] = [];
  for (const region of profile.collectorNumber) {
    const text = await readRegion(image, width, height, region);
    if (!text) continue;
    rawReadings.push(text);

    // Every band is read even once a good parse is found: the number and the
    // set abbreviation are not always in the same crop, and the abbreviation is
    // matched against the raw text rather than parsed out of it.
    const parsed = parseCollectorNumber(text);
    if (!parsed) continue;
    if (parsed.setTotal != null && reading.setTotal == null) {
      reading.collectorNumber = parsed.collectorNumber;
      reading.setTotal = parsed.setTotal;
    } else {
      reading.collectorNumber ??= parsed.collectorNumber;
    }
  }
  if (rawReadings.length > 0) reading.collectorNumberRaw = rawReadings.join(" ");

  for (const region of profile.hp) {
    const hp = parseHp(await readRegion(image, width, height, region));
    if (hp != null) {
      reading.hp = hp;
      break;
    }
  }

  return reading;
}
