// Builds the accuracy fixture set: a catalog slice spanning Pokemon eras, plus
// the card images to feed back through the pipeline.
//
//   pnpm --filter @magic-vault/server eval:build
//
// IMPORTANT: these are clean catalog renders, not camera captures. They measure
// whether ranking and OCR work at all, and they will flatter the pipeline —
// there is no glare, no white balance shift, no border, no motion blur. A
// meaningful baseline needs real captures from the scanner; see the note in
// accuracy.test.ts.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../src/db";
import { migrateDatabase } from "../src/db/migrate";
import { seedDatabase } from "../src/db/seed";
import { cardImageVectors } from "../src/db/schema";
import { POKEMON_DEFAULT_URL } from "../src/lib/pokemon/search";
import { pokemonSyncSource } from "../src/lib/pokemon/sync";
import { vectorizeImageFromBuffer } from "../src/lib/vectorize";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, "fixtures", "pokemon");

/** One set per era, so era-specific layout assumptions get exercised. */
const SETS = [
  "base1", // WOTC 1999
  "ecard1", // e-Card 2002 — collector number moves
  "ex1", // EX 2003
  "dp1", // Diamond & Pearl 2007
  "bw1", // Black & White 2011
  "xy1", // XY 2014
  "sm1", // Sun & Moon 2017
  "swsh1", // Sword & Shield 2020
  "sv01", // Scarlet & Violet 2023
];
const PER_SET = Number(process.env.EVAL_PER_SET ?? "8");

interface SetResponse {
  cards: { id: string; name: string; image?: string }[];
}

async function main() {
  await migrateDatabase();
  await seedDatabase();
  await mkdir(FIXTURES, { recursive: true });

  const rows: (typeof cardImageVectors.$inferInsert)[] = [];
  const manifest: { id: string; name: string; setCode: string; file: string }[] =
    [];

  for (const setCode of SETS) {
    const res = await fetch(`https://api.tcgdex.net/v2/en/sets/${setCode}`);
    if (!res.ok) {
      console.warn(`  skipping ${setCode}: HTTP ${res.status}`);
      continue;
    }
    const set = (await res.json()) as SetResponse;
    const picked = set.cards.filter((c) => c.image).slice(0, PER_SET);

    for (const card of picked) {
      try {
        const buf = Buffer.from(
          await (await fetch(`${card.image}/high.webp`)).arrayBuffer(),
        );
        const extras = await pokemonSyncSource.fetchExtras!(
          { id: card.id, name: card.name, setCode, imageUrl: undefined },
          POKEMON_DEFAULT_URL,
        );
        rows.push({
          scryfallId: card.id,
          gameKey: "pokemon",
          lang: "en",
          name: card.name,
          setCode,
          embedding: await vectorizeImageFromBuffer(buf),
          collectorNumber: extras.collectorNumber ?? null,
          setTotal: extras.setTotal ?? null,
          cardData: extras.data ?? null,
        });

        const file = `${card.id}.webp`;
        await writeFile(path.join(FIXTURES, file), buf);
        manifest.push({ id: card.id, name: card.name, setCode, file });
      } catch (err) {
        console.warn(`  ${card.id} failed:`, (err as Error).message);
      }
    }
    console.log(`  ${setCode}: ${picked.length} cards`);
  }

  await db.insert(cardImageVectors).values(rows).onConflictDoNothing();
  await writeFile(
    path.join(FIXTURES, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  console.log(`\n${rows.length} cards embedded, ${manifest.length} fixtures written.`);
  process.exit(0);
}

main();
