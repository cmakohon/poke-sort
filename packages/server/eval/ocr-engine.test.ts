import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import {
  getOcrEngine,
  productionCollectorPlan,
  readCard,
  resetOcrEngine,
  TESSERACT_ENGINE,
  VISION_ENGINE,
  WHOLE_CARD_PLAN,
  type OcrEngine,
  type TextRecognizer,
} from "../src/lib/identify/ocr";
import { POKEMON_PROFILE } from "../src/lib/identify/profiles";
import { disposeVision, visionRecognizer } from "../src/lib/identify/vision";
import { VISION_OCR_BIN } from "../src/config";
import { existsSync } from "node:fs";

const OCR = POKEMON_PROFILE.ocr!;

// getOcrEngine() probes, and probing spawns real sidecar processes and a temp
// directory. Without this the run ends holding live children open on any macOS
// machine where the sidecar is built.
afterAll(async () => {
  await disposeVision();
  resetOcrEngine();
});

/**
 * A recogniser that returns canned text without touching an OCR engine, so the
 * plumbing can be tested on every platform — including the CI runners that have
 * no Vision sidecar and would otherwise skip all of this.
 */
function stubRecognizer(text: string): TextRecognizer {
  return async () => text;
}

const blankCard = () =>
  sharp({ create: { width: 300, height: 420, channels: 3, background: "#fff" } })
    .jpeg()
    .toBuffer();

describe("collector-number plans", () => {
  it("reads the whole frame under Vision, with no escalation ladder", () => {
    expect(WHOLE_CARD_PLAN.bands).toHaveLength(1);
    expect(WHOLE_CARD_PLAN.bands[0].region).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
    // Raw and unscaled: every transform in ReadOptions exists to make a crop
    // binarisable, which is the thing a scene-text engine does not need.
    expect(WHOLE_CARD_PLAN.bands[0].opts).toMatchObject({ raw: true, scale: 1 });
    // The ladder is four hard thresholds. Running it under Vision would be
    // paying for binarisation retries that cannot help.
    expect(WHOLE_CARD_PLAN.escalation).toBeUndefined();
  });

  it("keeps the era band table and the ladder under Tesseract", () => {
    const plan = TESSERACT_ENGINE.plan(OCR);
    expect(plan.bands).toHaveLength(OCR.collectorNumber.length);
    expect(plan.escalation).toBeDefined();
    // By reference to the shipped builder, not a copy of its output.
    expect(plan).toEqual(productionCollectorPlan(OCR));
  });

  it("pairs each engine with the plan it can actually read", () => {
    // The pairing is the invariant that matters: handing Tesseract the
    // whole-card plan makes it read the rules text as a collector number, and
    // handing Vision the narrow hard-thresholded bands throws away most of its
    // advantage. A fallback that swapped one without the other would do that
    // silently.
    expect(VISION_ENGINE.plan(OCR)).toBe(WHOLE_CARD_PLAN);
    expect(TESSERACT_ENGINE.plan(OCR)).not.toBe(WHOLE_CARD_PLAN);
    expect(VISION_ENGINE.name).toBe("vision");
    expect(TESSERACT_ENGINE.name).toBe("tesseract");
  });
});

describe("whole-card reading", () => {
  it("parses the printed number out of a full-card transcript", async () => {
    // What Vision actually returns for a capture: every line on the card, the
    // collector number among them. The narrow parser regexes have to find it
    // without being fooled by the Pokedex number, the HP, or the damage values.
    const transcript = [
      "Drifloon Lv.10",
      "BASIC",
      "HP40",
      "NO. 425 Balloon Pokémon HT: 1'04\" WT: 2.6 lbs.",
      "Reckless Charge",
      "20",
      "@2009 Pokémon/ Nintendo",
      "Illus. Mitsuhiro Arita",
      "103/147",
    ].join("\n");

    const reading = await readCard(
      await blankCard(),
      OCR,
      stubRecognizer(transcript),
      WHOLE_CARD_PLAN,
    );

    expect(reading.collectorNumber).toBe("103");
    expect(reading.setTotal).toBe(147);
  });

  it("does not mistake a Pokédex number for a collector number", async () => {
    // "NO. 425" and "HP40" are on every card of that era and neither is a
    // fraction, so a whole-card read must come back with nothing rather than
    // with a confident wrong number — a matched number scores 1.0 in the
    // re-ranker and outvotes the embedding.
    const reading = await readCard(
      await blankCard(),
      OCR,
      stubRecognizer("Drifloon\nBASIC\nHP40\nNO. 425 Balloon Pokémon"),
      WHOLE_CARD_PLAN,
    );
    expect(reading.setTotal).toBeUndefined();
  });
});

describe("engine selection", () => {
  it("resolves to a real engine whose plan matches it", async () => {
    // Deliberately does not assert WHICH engine: that depends on the platform
    // and on whether the sidecar was built. What must hold everywhere is that
    // the result is one of the two known engines, carrying its own plan.
    const engine: OcrEngine = await getOcrEngine();
    expect([VISION_ENGINE, TESSERACT_ENGINE]).toContain(engine);
    expect(engine.plan(OCR)).toEqual(
      engine.name === "vision" ? WHOLE_CARD_PLAN : productionCollectorPlan(OCR),
    );
  });

  it("is decided once and reused", async () => {
    // The probe spawns a sidecar and runs a recognition through it. Doing that
    // per scan would put process startup on the critical path of every card.
    expect(await getOcrEngine()).toBe(await getOcrEngine());
  });

  it("never selects Vision off macOS", async () => {
    const engine = await getOcrEngine();
    if (process.platform !== "darwin") {
      expect(engine.name).toBe("tesseract");
    }
  });
});

// Only meaningful where a sidecar exists; the pool is a macOS concern.
const hasVision = process.platform === "darwin" && existsSync(VISION_OCR_BIN);

describe.runIf(hasVision)("vision pool", () => {
  it("settles reads queued behind the pool instead of stranding them", async () => {
    // One card fans out over more crops than there are workers (POOL_SIZE is 2),
    // so callers are routinely parked in the acquire queue. A queued caller that
    // is never woken never settles — which stalls the scan, then the HTTP
    // request, then the graceful shutdown waiting on that request. Losing the
    // pool has to reject them, not drop them.
    const png = await sharp({
      create: { width: 64, height: 32, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();

    // Force the pool up FIRST. Without this every read rejects at the
    // `pool === null` guard before it ever reaches the acquire queue, and the
    // test passes against the very bug it is meant to catch.
    await visionRecognizer(png);

    const reads = Array.from({ length: 32 }, () =>
      visionRecognizer(png).then(
        () => "ok" as const,
        () => "rejected" as const,
      ),
    );
    // Long enough for two of them to be in flight and the rest to be parked in
    // `waiters`, short enough that the queue cannot drain.
    await new Promise((r) => setTimeout(r, 5));
    // Pull the pool out from under the queue.
    await disposeVision();

    const outcomes = await Promise.race([
      Promise.all(reads),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("queued reads never settled")), 5000),
      ),
    ]);
    expect(outcomes).toHaveLength(32);
    resetOcrEngine();
  });
});
