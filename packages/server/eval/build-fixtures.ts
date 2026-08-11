// Builds the accuracy fixture set from the catalog that is already loaded.
//
//   POKE_SORT_DATA_DIR=./.poke-sort-catalog pnpm --filter @poke-sort/server eval:build
//
// Probes are the `high` render of cards already in the catalog, resized to the
// scanner's capture resolution and degraded the way a camera degrades things.
// That is a genuinely different image of the same card, at a resolution where
// the printed text is actually legible.
//
// The previous version built its own 72-card catalog and probed it with the
// exact images it had just embedded, which made top-1 a tautology (distance 0
// by construction) and gave it only 71 distractors. Both are why it reported
// 100%. Running against the full catalog restores the thing that actually makes
// identification hard: a Pikachu's nearest neighbour is another Pikachu.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { db } from "../src/db";
import { migrateDatabase } from "../src/db/migrate";
import { cardImageVectors } from "../src/db/schema";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, "fixtures", "pokemon");

const SAMPLE = Number(process.env.EVAL_SAMPLE ?? "150");

/** What the scanner actually crops to. */
const CAPTURE_W = 745;
const CAPTURE_H = 1043;

/**
 * Degrades a clean render into something shaped like a webcam capture.
 *
 * The previous fixtures used TCGdex's `low` render — 245px wide, where the
 * collector-number band is ~30px tall and the digits within it under 15px.
 * Tesseract cannot read that, so the eval scored OCR at 5% and was blind to
 * any change to it. A real capture is 745px, where the same band is ~94px.
 *
 * So probes start from the `high` render at capture resolution and have the
 * things a camera adds applied on top: blur, a glare gradient, a white balance
 * shift, a slight rotation and JPEG loss. Still not a real photograph — no
 * depth of field, no sleeve reflections — but it exercises the pipeline at a
 * resolution where reading the card is possible, which is the point.
 *
 * Deterministic per index so a rebuild produces the same fixtures.
 */
async function degrade(buf: Buffer, seed: number): Promise<Buffer> {
  const r = (n: number, lo: number, hi: number) =>
    lo + (((seed * 9301 + n * 49297) % 233280) / 233280) * (hi - lo);

  const glare = Buffer.from(
    `<svg width="${CAPTURE_W}" height="${CAPTURE_H}">
       <defs><linearGradient id="g" x1="${r(1, 0, 0.4).toFixed(2)}" y1="0" x2="1" y2="1">
         <stop offset="0%" stop-color="#fff" stop-opacity="${r(2, 0.05, 0.22).toFixed(2)}"/>
         <stop offset="55%" stop-color="#fff" stop-opacity="0"/>
       </linearGradient></defs>
       <rect width="100%" height="100%" fill="url(#g)"/>
     </svg>`,
  );

  return sharp(buf)
    .resize(CAPTURE_W, CAPTURE_H, { fit: "fill" })
    .rotate(r(3, -1.2, 1.2), { background: "#111" })
    .resize(CAPTURE_W, CAPTURE_H, { fit: "cover" })
    .modulate({
      brightness: r(4, 0.9, 1.12),
      saturation: r(5, 0.85, 1.1),
    })
    // Warm/cool cast, as a cheap stand-in for white balance drift.
    .tint({ r: 255, g: Math.round(r(6, 246, 255)), b: Math.round(r(7, 240, 255)) })
    .blur(r(8, 0.3, 1.1))
    .composite([{ input: glare, blend: "screen" }])
    .jpeg({ quality: Math.round(r(9, 72, 92)) })
    .toBuffer();
}

interface Row extends Record<string, unknown> {
  card_id: string;
  name: string;
  set_code: string;
  card_data: unknown;
}

async function main() {
  await migrateDatabase();
  await mkdir(FIXTURES, { recursive: true });

  const total = await db.$count(cardImageVectors);
  if (total < 1000) {
    console.error(
      `Catalog has only ${total} cards. Point POKE_SORT_DATA_DIR at the full ` +
        `catalog — a small one makes this test meaninglessly easy.`,
    );
    process.exit(1);
  }

  // Evenly spaced across the id-sorted catalog so the sample spans every era,
  // rather than clustering in whichever sets happen to sort first.
  const rows = await db.execute<Row>(sql`
    SELECT card_id, name, set_code, card_data
    FROM cards
    WHERE card_data IS NOT NULL
    ORDER BY card_id
  `);
  const step = Math.max(1, Math.floor(rows.rows.length / SAMPLE));
  const picked = rows.rows.filter((_, i) => i % step === 0).slice(0, SAMPLE);

  console.log(`catalog: ${total} cards — sampling ${picked.length} probes`);

  const manifest: {
    id: string;
    name: string;
    setCode: string;
    file: string;
  }[] = [];

  for (const row of picked) {
    const image = (row.card_data as { image?: string } | null)?.image;
    if (!image) continue;
    try {
      const res = await fetch(`${image}/high.webp`);
      if (!res.ok) continue;
      const file = `${row.card_id}.jpg`;
      await writeFile(
        path.join(FIXTURES, file),
        await degrade(Buffer.from(await res.arrayBuffer()), manifest.length + 1),
      );
      manifest.push({
        id: row.card_id,
        name: row.name,
        setCode: row.set_code,
        file,
      });
    } catch {
      /* unreachable image — skip */
    }
  }

  await writeFile(
    path.join(FIXTURES, "manifest.json"),
    JSON.stringify(
      {
        catalogSize: total,
        generatedFrom: `high render degraded to ${CAPTURE_W}x${CAPTURE_H}`,
        cards: manifest,
      },
      null,
      2,
    ),
  );

  console.log(`${manifest.length} probes written to ${FIXTURES}`);
  process.exit(0);
}

main();
