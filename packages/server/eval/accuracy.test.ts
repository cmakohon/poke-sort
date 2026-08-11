import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { identifyCard } from "../src/lib/identify";
import { disposeOcr } from "../src/lib/identify/ocr";
import { vectorizeImageFromBuffer } from "../src/lib/vectorize";

/**
 * Identification accuracy against the real catalog.
 *
 *   POKE_SORT_DATA_DIR=./.poke-sort-catalog pnpm eval:build   # once
 *   POKE_SORT_DATA_DIR=./.poke-sort-catalog pnpm test
 *
 * Probes are the LOW-quality render of a card in the catalog: a different image
 * of the same card, ~0.042 away in embedding space against ~0.165 to a
 * different card. Two things this fixes over the previous version, which
 * reported a meaningless 100% top-1:
 *
 *  - It is no longer a tautology. Probing with the exact image that was
 *    embedded gives distance 0 by construction.
 *  - The distractors are real. 21,714 cards, where a Pikachu's nearest
 *    neighbour is another Pikachu — not 71 cards from ten sets.
 *
 * ⚠ Still not a substitute for camera captures. A downscaled render has no
 * glare, white balance shift, border or blur, so this remains optimistic — but
 * it is now a measurement rather than a restatement of the setup.
 *
 * The metric that matters is the FALSE ACCEPT rate: a card confidently sorted
 * into the wrong bin is worse than one set aside for a human, because nobody
 * finds out until much later.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, "fixtures", "pokemon");

interface Fixture {
  id: string;
  name: string;
  setCode: string;
  file: string;
}

interface Manifest {
  catalogSize: number;
  generatedFrom: string;
  cards: Fixture[];
}

let catalogSize = 0;
let generatedFrom = "";

async function loadManifest(): Promise<Fixture[]> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(FIXTURES, "manifest.json"), "utf-8"),
    ) as Manifest;
    catalogSize = parsed.catalogSize;
    generatedFrom = parsed.generatedFrom;
    return parsed.cards;
  } catch {
    return [];
  }
}

const manifest = await loadManifest();

describe.skipIf(manifest.length === 0)("pokemon identification accuracy", () => {
  afterAll(async () => {
    await disposeOcr();
  });

  it("reports accuracy across the fixture set", async () => {
    let top1 = 0;
    let top5 = 0;
    let accepted = 0;
    let falseAccept = 0;
    let review = 0;
    let noMatch = 0;

    const failures: string[] = [];
    const reviewReasons: string[] = [];
    const ocrFlag = (v: unknown) => (v ? "y" : "n");

    for (const fixture of manifest) {
      const buf = await readFile(path.join(FIXTURES, fixture.file));
      const embedding = await vectorizeImageFromBuffer(buf);
      const result = await identifyCard(embedding, buf, "pokemon", "en");

      const ids = result.candidates.map((c) => c.id);
      const isTop1 = ids[0] === fixture.id;
      if (isTop1) top1++;
      if (ids.slice(0, 5).includes(fixture.id)) top5++;

      if (result.tier === "accept") {
        accepted++;
        if (!isTop1) {
          falseAccept++;
          failures.push(`${fixture.id} -> ${ids[0] ?? "none"} (accepted)`);
        }
      } else if (result.tier === "review") {
        review++;
        // Why it was held back matters more than the count: a low score and a
        // thin margin call for different fixes.
        const top = result.candidates[0];
        reviewReasons.push(
          `${fixture.id} score=${top?.score.toFixed(2)} margin=${result.margin?.toFixed(2) ?? "n/a"}` +
            ` ocrName=${ocrFlag(result.ocr?.name)} ocrNum=${ocrFlag(result.ocr?.collectorNumberRaw)}` +
            ` correctTop1=${isTop1}`,
        );
      } else {
        noMatch++;
      }
    }

    const n = manifest.length;
    const pct = (v: number) => `${((v / n) * 100).toFixed(1)}%`;
    console.log(
      [
        "",
        `catalog:       ${catalogSize} cards`,
        `probes:        ${n} (${generatedFrom})`,
        `top-1:         ${top1} (${pct(top1)})`,
        `top-5:         ${top5} (${pct(top5)})`,
        `accepted:      ${accepted} (${pct(accepted)})`,
        `  false accept:${falseAccept} (${pct(falseAccept)})  <- the metric that matters`,
        `review:        ${review} (${pct(review)})`,
        `no-match:      ${noMatch} (${pct(noMatch)})`,
        ...(failures.length ? ["", "wrongly accepted:", ...failures.map((f) => `  ${f}`)] : []),
        ...(reviewReasons.length
          ? ["", "held for review:", ...reviewReasons.map((r) => `  ${r}`)]
          : []),
        "",
      ].join("\n"),
    );

    // A regression guard, not a target. These are floors the pipeline clears
    // today against degraded probes over the full catalog; tighten them as it
    // improves rather than loosening them when something breaks.
    expect(top1 / n).toBeGreaterThan(0.85);
    expect(falseAccept / n).toBeLessThan(0.05);
  }, 600_000);
});
