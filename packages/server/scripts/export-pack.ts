// Builds an embedding pack for one (game, lang) from the local database and
// writes it gzipped. Published as a GitHub Release asset; the app imports it on
// first run instead of spending hours embedding the catalog itself.
//
// Run under Node while the server is stopped — PGlite is single-process.
//
//   pnpm --filter @magic-vault/server export:pack -- pokemon en ./pokemon-en.pack.gz
import { writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../src/db";
import { cardImageVectors } from "../src/db/schema";
import { EMBEDDING_IDENTITY } from "../src/lib/embedding-identity";
import { encodePack } from "../src/lib/pack/format";

async function main() {
  const [gameKey, lang = "en", out] = process.argv.slice(2);
  if (!gameKey || !out) {
    console.error(
      "usage: export-pack.ts <gameKey> <lang> <outFile.pack.gz>",
    );
    process.exit(1);
  }

  const rows = await db
    .select({
      id: cardImageVectors.scryfallId,
      name: cardImageVectors.name,
      setCode: cardImageVectors.setCode,
      collectorNumber: cardImageVectors.collectorNumber,
      setTotal: cardImageVectors.setTotal,
      data: cardImageVectors.cardData,
      embedding: cardImageVectors.embedding,
    })
    .from(cardImageVectors)
    .where(
      and(
        eq(cardImageVectors.gameKey, gameKey),
        eq(cardImageVectors.lang, lang),
      ),
    )
    // Stable order so two exports of the same data produce the same bytes.
    .orderBy(asc(cardImageVectors.scryfallId));

  if (rows.length === 0) {
    console.error(`No cards found for game=${gameKey} lang=${lang}.`);
    process.exit(1);
  }

  const dim = rows[0].embedding.length;
  if (dim !== EMBEDDING_IDENTITY.dim) {
    console.error(
      `Refusing to export: stored vectors are ${dim}-dim but this build produces ${EMBEDDING_IDENTITY.dim}.`,
    );
    process.exit(1);
  }
  const packed = encodePack(
    {
      gameKey,
      lang,
      dim,
      createdAt: new Date().toISOString(),
      model: EMBEDDING_IDENTITY.model,
      dtype: EMBEDDING_IDENTITY.dtype,
      preprocessing: EMBEDDING_IDENTITY.preprocessing,
      setCodes: [...new Set(rows.map((r) => r.setCode))].sort(),
      cards: rows.map((r) => ({
        id: r.id,
        name: r.name,
        setCode: r.setCode,
        collectorNumber: r.collectorNumber,
        setTotal: r.setTotal,
        data: r.data,
      })),
    },
    rows.map((r) => r.embedding),
  );

  const gz = gzipSync(packed, { level: 9 });
  await writeFile(out, gz);

  console.log(
    `${rows.length} cards, ${dim} dims -> ${out} ` +
      `(${(packed.length / 1e6).toFixed(1)} MB raw, ${(gz.length / 1e6).toFixed(1)} MB gzipped)`,
  );
  process.exit(0);
}

main();
