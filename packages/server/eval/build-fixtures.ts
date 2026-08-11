// Builds the accuracy fixture set from the catalog that is already loaded.
//
//   MAULT_DATA_DIR=./.mault-catalog pnpm --filter @magic-vault/server eval:build
//
// Probes are the LOW-quality render of cards already in the catalog. That is a
// genuinely different image of the same card — measured ~0.042 away, versus
// ~0.165 to a different card — so the test asks a real question.
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
import { db } from "../src/db";
import { migrateDatabase } from "../src/db/migrate";
import { cardImageVectors } from "../src/db/schema";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, "fixtures", "pokemon");

const SAMPLE = Number(process.env.EVAL_SAMPLE ?? "150");

interface Row extends Record<string, unknown> {
  scryfall_id: string;
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
      `Catalog has only ${total} cards. Point MAULT_DATA_DIR at the full ` +
        `catalog — a small one makes this test meaninglessly easy.`,
    );
    process.exit(1);
  }

  // Evenly spaced across the id-sorted catalog so the sample spans every era,
  // rather than clustering in whichever sets happen to sort first.
  const rows = await db.execute<Row>(sql`
    SELECT scryfall_id, name, set_code, card_data
    FROM cards
    WHERE card_data IS NOT NULL
    ORDER BY scryfall_id
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
      const res = await fetch(`${image}/low.webp`);
      if (!res.ok) continue;
      const file = `${row.scryfall_id}.webp`;
      await writeFile(
        path.join(FIXTURES, file),
        Buffer.from(await res.arrayBuffer()),
      );
      manifest.push({
        id: row.scryfall_id,
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
      { catalogSize: total, generatedFrom: "low-quality render", cards: manifest },
      null,
      2,
    ),
  );

  console.log(`${manifest.length} probes written to ${FIXTURES}`);
  process.exit(0);
}

main();
