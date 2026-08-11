import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { detectFirstEditionStamp } from "../src/lib/identify/stamp";

/**
 * 1st Edition stamp detection, evaluated without hand labels.
 *
 * Ground truth by construction: Base Set 2 (base4) and the Wizards promos
 * (basep) never had 1st Edition printings, so their renders CANNOT be stamped —
 * guaranteed negatives on exactly the frame layout the detector targets.
 * Compositing a real stamp (cut from a TCGdex Base Set scan, which are
 * themselves 1st Edition copies) onto those same cards produces guaranteed
 * positives. Both labels survive fixture resampling, unlike anything based on
 * eyeballing whichever cards the sampler picked this time.
 *
 * Gated-era fixtures (base/gym/neo) are reported but not asserted: whether
 * TCGdex's scan of a given card happens to be a 1st Edition copy is their
 * archive's property, not this detector's.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, "fixtures", "pokemon");
const TEMPLATE = path.join(here, "static", "first-edition-stamp.png");

interface Fixture {
  id: string;
  file: string;
}

async function loadManifest(): Promise<Fixture[]> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(FIXTURES, "manifest.json"), "utf-8"),
    ) as { cards: Fixture[] };
    return parsed.cards;
  } catch {
    return [];
  }
}

const manifest = await loadManifest();
const guaranteedUnstamped = manifest.filter((f) =>
  /^(base4|basep)-/.test(f.id),
);

/** The canonical stamp position, with per-index jitter so alignment tolerance
 *  is exercised rather than assumed. */
async function composite(buf: Buffer, seed: number): Promise<Buffer> {
  const template = await readFile(TEMPLATE);
  const jitter = (n: number, range: number) =>
    Math.round((((seed * 7919 + n * 104729) % 1000) / 1000 - 0.5) * 2 * range);
  return sharp(buf)
    .composite([
      {
        input: template,
        left: Math.round(745 * 0.04) + jitter(1, 8),
        top: Math.round(1043 * 0.515) + jitter(2, 8),
      },
    ])
    .jpeg({ quality: 85 })
    .toBuffer();
}

describe.skipIf(guaranteedUnstamped.length === 0)("first edition stamp", () => {
  it("reads guaranteed-unstamped frames as unstamped", async () => {
    for (const f of guaranteedUnstamped) {
      const reading = await detectFirstEditionStamp(
        await readFile(path.join(FIXTURES, f.file)),
      );
      expect(reading.stamped, `${f.id} darkFrac=${reading.darkFrac.toFixed(3)} spread=${reading.spread.toFixed(2)}`).toBe(false);
    }
  });

  it("detects a real stamp composited onto those same frames", async () => {
    let i = 0;
    for (const f of guaranteedUnstamped) {
      const stamped = await composite(
        await readFile(path.join(FIXTURES, f.file)),
        ++i,
      );
      const reading = await detectFirstEditionStamp(stamped);
      expect(reading.stamped, `${f.id}+stamp darkFrac=${reading.darkFrac.toFixed(3)} spread=${reading.spread.toFixed(2)}`).toBe(true);
    }
  });

  it("reports detections across the gated-era fixtures", async () => {
    const gated = manifest.filter((f) =>
      /^(base1|base2|base3|base5|gym|neo)-/.test(f.id),
    );
    const lines: string[] = [];
    for (const f of gated) {
      const r = await detectFirstEditionStamp(
        await readFile(path.join(FIXTURES, f.file)),
      );
      lines.push(
        `  ${f.id.padEnd(12)} ${r.stamped ? "STAMPED" : "plain  "} darkFrac=${r.darkFrac.toFixed(3)} spread=${r.spread.toFixed(2)}`,
      );
    }
    console.log(["", "gated-era renders (report only):", ...lines, ""].join("\n"));
    expect(gated.length).toBeGreaterThan(0);
  });
});
