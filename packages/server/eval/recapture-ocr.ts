// Rewrites only the OCR half of a signals dump, so eval:tune can measure a
// different recogniser end to end.
//
//   EVAL_FIXTURES=pokemon-real pnpm exec tsx eval/recapture-ocr.ts vision
//   EVAL_FIXTURES=pokemon-real pnpm exec tsx eval/recapture-ocr.ts visionfull
//   EVAL_FIXTURES=pokemon-real-vision pnpm eval:tune
//
// Why not re-run eval:capture: candidates depend on the catalog, the embedding
// and the art windows — none of which an OCR change touches. Holding them
// fixed and varying ONLY the reading is both much cheaper (no database, no
// forward pass, no PGlite single-process hazard) and a better experiment: any
// difference eval:tune then reports is attributable to the recogniser and
// nothing else.
//
// Arms:
//   vision      the shipping bands, read by Apple Vision instead of Tesseract
//   visionfull  same, except the collector number comes from ONE read of the
//               whole card. That won the 2026-08-27 sweep (924/1068 against
//               883 banded and 269 for Tesseract). Name and HP stay banded on
//               purpose: the whole-card text's longest line is rules text, not
//               the name, and parseHp would happily take an attack's damage
//               number. The sidecar returns no bounding boxes, so there is no
//               way to scope those two from a single read yet.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OcrReading } from "@poke-sort/shared";
import { readCard, WHOLE_CARD_PLAN } from "../src/lib/identify/ocr";
import { POKEMON_PROFILE } from "../src/lib/identify/profiles";
import { EVAL_SET, FIXTURES_DIR, SIGNALS_PATH } from "./eval-set";
import { disposeVision, visionRecognizer } from "./vision-ocr";

interface Capture {
  expectedId: string;
  setCode: string;
  file?: string;
  ocr: OcrReading;
  candidates: unknown[];
}

async function main() {
  const arm = process.argv[2];
  if (arm !== "vision" && arm !== "visionfull") {
    throw new Error(`usage: recapture-ocr.ts <vision|visionfull>`);
  }
  const out = SIGNALS_PATH.replace(/\.json$/, "").replace(
    `signals-${EVAL_SET}`,
    `signals-${EVAL_SET}-${arm}`,
  ) + ".json";

  const { captures } = JSON.parse(await readFile(SIGNALS_PATH, "utf-8")) as {
    captures: Capture[];
  };
  const profile = POKEMON_PROFILE.ocr!;
  const plan = arm === "visionfull" ? WHOLE_CARD_PLAN : undefined;

  // Bounded fan-out; the Vision pool (OCR_POOL_SIZE) is what actually limits
  // concurrency, this just keeps every process fed.
  const lanes = Math.max(2, Number(process.env.OCR_POOL_SIZE) || 2);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      for (let i = next++; i < captures.length; i = next++) {
        const capture = captures[i];
        const file = capture.file ?? `${capture.expectedId}.jpg`;
        const buf = await readFile(path.join(FIXTURES_DIR, file));
        capture.ocr = await readCard(buf, profile, visionRecognizer, plan).catch(
          (err) => {
            console.error(`[recapture] ${file}: ${err}`);
            return {} as OcrReading;
          },
        );
        if (++done % 100 === 0) console.log(`  ${done}/${captures.length}`);
      }
    }),
  );

  await writeFile(out, JSON.stringify({ captures }, null, 1));
  console.log(`${captures.length} captures -> ${out}`);
  await disposeVision();
  process.exit(0);
}

main();
