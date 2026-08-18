// Measures collector-number OCR hit rate for band/preprocessing variants.
//
//   pnpm exec tsx eval/ocr-sweep.ts
//
// Greedy-sequential: best band set under current preprocessing, then best
// preprocessing under the winning bands, then page-segmentation mode. A full
// cross product would be ~an hour of Tesseract; the greedy pass is ~15 minutes
// and the dimensions are close to independent (bands decide WHAT text is in
// the crop, preprocessing decides how legible it is).
//
// The subsample is stratified toward the eras that currently fail — every
// classic/ex/dp fixture, plus a modern guard set to catch regressions.
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createWorker, type Worker } from "tesseract.js";
import { parseCollectorNumber } from "../src/lib/identify/ocr";
import type { OcrRegion } from "../src/lib/identify/profiles";
import { EVAL_SET, FIXTURES_DIR, SIGNALS_PATH } from "./eval-set";

const FIXTURES = FIXTURES_DIR;

type BandSet = { label: string; bands: OcrRegion[] };
type Prep = { label: string; apply: (s: sharp.Sharp, w: number) => sharp.Sharp };

const BAND_SETS: BandSet[] = [
  {
    label: "current",
    bands: [
      { x0: 0.5, y0: 0.9, x1: 0.99, y1: 0.97 },
      { x0: 0.02, y0: 0.9, x1: 0.5, y1: 0.97 },
      { x0: 0.02, y0: 0.92, x1: 0.99, y1: 1.0 },
    ],
  },
  {
    // The right band pushed down to where dp/base actually print the number.
    label: "deep-right",
    bands: [
      { x0: 0.5, y0: 0.945, x1: 0.99, y1: 0.995 },
      { x0: 0.02, y0: 0.9, x1: 0.5, y1: 0.97 },
      { x0: 0.02, y0: 0.92, x1: 0.99, y1: 1.0 },
    ],
  },
  {
    // Deep + a mid-right band so the ex/xy/bw position keeps its own crop.
    label: "deep+mid-right",
    bands: [
      { x0: 0.5, y0: 0.945, x1: 0.99, y1: 0.995 },
      { x0: 0.5, y0: 0.895, x1: 0.99, y1: 0.95 },
      { x0: 0.02, y0: 0.9, x1: 0.5, y1: 0.97 },
      { x0: 0.03, y0: 0.93, x1: 0.97, y1: 0.995 },
    ],
  },
  {
    // The production set with the left band tightened to just the number
    // line: on real me-era captures the wide left crop drags in the Illus.
    // line and the set-code icons, and a narrower crop upsamples the digits
    // ~1.4x more for the same read.
    label: "tight-left",
    bands: [
      { x0: 0.5, y0: 0.945, x1: 0.99, y1: 0.995 },
      { x0: 0.5, y0: 0.895, x1: 0.99, y1: 0.95 },
      { x0: 0.02, y0: 0.915, x1: 0.38, y1: 0.968 },
      { x0: 0.03, y0: 0.93, x1: 0.97, y1: 0.995 },
    ],
  },
  {
    // Same tight bottom-left, kept alongside the original left band rather
    // than replacing it, in case some era needs the taller crop.
    label: "tight-left+wide-left",
    bands: [
      { x0: 0.5, y0: 0.945, x1: 0.99, y1: 0.995 },
      { x0: 0.5, y0: 0.895, x1: 0.99, y1: 0.95 },
      { x0: 0.02, y0: 0.915, x1: 0.38, y1: 0.968 },
      { x0: 0.02, y0: 0.9, x1: 0.5, y1: 0.97 },
      { x0: 0.03, y0: 0.93, x1: 0.97, y1: 0.995 },
    ],
  },
];

const PREPS: Prep[] = [
  {
    label: "3x-normalise (current)",
    apply: (s, w) => s.resize({ width: w * 3 }).greyscale().normalise(),
  },
  {
    label: "3x-normalise-sharpen",
    apply: (s, w) => s.resize({ width: w * 3 }).greyscale().normalise().sharpen(),
  },
  {
    label: "4x-contrast-sharpen",
    apply: (s, w) =>
      s.resize({ width: w * 4 }).greyscale().linear(1.35, -35).sharpen(),
  },
];

const PSMS = ["3", "7"] as const;

interface Probe {
  file: string;
  id: string;
  expectNum: string;
  expectTotal: number | null;
  era: string;
}

let worker: Worker | null = null;
async function getWorker(): Promise<Worker> {
  if (!worker) worker = await createWorker("eng");
  return worker;
}

async function readBand(
  buf: Buffer,
  region: OcrRegion,
  prep: Prep,
  psm: string,
): Promise<string> {
  const image = sharp(buf);
  const meta = await image.metadata();
  const width = meta.width ?? 745;
  const height = meta.height ?? 1043;
  const left = Math.round(region.x0 * width);
  const top = Math.round(region.y0 * height);
  const w = Math.min(width - left, Math.round((region.x1 - region.x0) * width));
  const h = Math.min(height - top, Math.round((region.y1 - region.y0) * height));
  if (w <= 0 || h <= 0) return "";
  const crop = await prep
    .apply(image.extract({ left, top, width: w, height: h }), w)
    .withMetadata({ density: 300 })
    .png()
    .toBuffer();
  const wk = await getWorker();
  await wk.setParameters({
    tessedit_char_whitelist: "",
    tessedit_pageseg_mode: psm as never,
  });
  const { data } = await wk.recognize(crop);
  return data.text.trim();
}

const strip = (v: string) => v.replace(/^0+(?=\d)/, "").toLowerCase();

async function score(
  probes: Probe[],
  bands: OcrRegion[],
  prep: Prep,
  psm: string,
): Promise<{ hit: number; full: number; byEra: Record<string, string>; ms: number }> {
  let hit = 0;
  let full = 0;
  const eraHit: Record<string, [number, number]> = {};
  const t0 = Date.now();
  for (const p of probes) {
    const buf = await readFile(path.join(FIXTURES, p.file));
    let got = false;
    let gotFull = false;
    for (const band of bands) {
      const text = await readBand(buf, band, prep, psm);
      const parsed = parseCollectorNumber(text);
      if (!parsed) continue;
      if (strip(parsed.collectorNumber) === strip(p.expectNum)) {
        got = true;
        if (p.expectTotal != null && parsed.setTotal === p.expectTotal) gotFull = true;
      }
    }
    if (got) hit++;
    if (gotFull) full++;
    const e = (eraHit[p.era] ??= [0, 0]);
    e[1]++;
    if (got) e[0]++;
  }
  const byEra = Object.fromEntries(
    Object.entries(eraHit).map(([k, [h, n]]) => [k, `${h}/${n}`]),
  );
  return { hit, full, byEra, ms: Date.now() - t0 };
}

async function main() {
  const { captures } = JSON.parse(
    await readFile(SIGNALS_PATH, "utf-8"),
  ) as {
    captures: {
      expectedId: string;
      setCode: string;
      file?: string;
      candidates: { id: string; setTotal: number | null }[];
    }[];
  };

  const POCKET = /^(A\d|B\d|P-A)/;
  const WEAK = /^(dp|ex|base|ecard|neo|hgss|pl|gym|pop|cel|dc|g1|np|si|ru|sve|swshp|svp|mcd|bwp|xyp|dpp|col|fut)/;

  const probes: Probe[] = [];
  const modernGuard: Probe[] = [];
  for (const c of captures) {
    if (POCKET.test(c.expectedId)) continue; // digital-only; never physically scanned
    const self = c.candidates.find((x) => x.id === c.expectedId);
    const probe: Probe = {
      // Older signal dumps predate the file field; renders are named by id.
      file: c.file ?? `${c.expectedId}.jpg`,
      id: c.expectedId,
      expectNum: c.expectedId.split("-").pop()!.replace(/^0+(?=\d)/, ""),
      expectTotal: self?.setTotal ?? null,
      era: c.setCode.replace(/[\d.]+$/, "") || c.setCode,
    };
    if (WEAK.test(c.expectedId)) probes.push(probe);
    else modernGuard.push(probe);
  }
  // Every weak-era fixture, plus every 3rd modern one as a regression guard.
  // Real-capture sets are small and every label was paid for at the review
  // screen, so they run whole.
  const sample =
    EVAL_SET === "pokemon"
      ? [...probes, ...modernGuard.filter((_, i) => i % 3 === 0)]
      : [...probes, ...modernGuard];
  console.log(`${sample.length} probes (${probes.length} weak-era, ${sample.length - probes.length} modern guard)\n`);

  // Pass 1: bands under current prep/psm.
  let bestBands = BAND_SETS[0];
  let bestHit = -1;
  for (const bs of BAND_SETS) {
    const r = await score(sample, bs.bands, PREPS[0], "3");
    console.log(
      `bands=${bs.label.padEnd(16)} hit=${r.hit}/${sample.length} full=${r.full} ${(r.ms / 1000).toFixed(0)}s ${JSON.stringify(r.byEra)}`,
    );
    if (r.hit > bestHit) {
      bestHit = r.hit;
      bestBands = bs;
    }
  }

  // Pass 2: preprocessing under the winning bands.
  console.log("");
  let bestPrep = PREPS[0];
  bestHit = -1;
  for (const prep of PREPS) {
    const r = await score(sample, bestBands.bands, prep, "3");
    console.log(
      `prep=${prep.label.padEnd(24)} hit=${r.hit}/${sample.length} full=${r.full} ${(r.ms / 1000).toFixed(0)}s`,
    );
    if (r.hit > bestHit) {
      bestHit = r.hit;
      bestPrep = prep;
    }
  }

  // Pass 3: page segmentation mode.
  console.log("");
  for (const psm of PSMS) {
    const r = await score(sample, bestBands.bands, bestPrep, psm);
    console.log(
      `psm=${psm} hit=${r.hit}/${sample.length} full=${r.full} ${(r.ms / 1000).toFixed(0)}s ${JSON.stringify(r.byEra)}`,
    );
  }

  console.log(`\nwinners: bands=${bestBands.label} prep=${bestPrep.label}`);
  await worker?.terminate();
  process.exit(0);
}

main();
