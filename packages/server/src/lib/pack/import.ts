import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { cardImageVectors } from "../../db/schema";
import { incompatibilityReason } from "../embedding-identity";
import { invalidateFacets } from "../facets";
import { decodePack, type PackHeader } from "./format";

/** Matches the sync writer: ~250 x 768 floats keeps a statement near 2 MB. */
const BATCH_SIZE = 250;

export interface PackImportResult {
  header: PackHeader;
  inserted: number;
}

/**
 * Streams a pack into the `cards` table.
 *
 * Import is idempotent (`onConflictDoNothing` on the unique card id), so a
 * re-run after a partial import resumes rather than duplicating.
 */
export async function importPack(
  filePath: string,
  onProgress?: (done: number, total: number) => void,
): Promise<PackImportResult> {
  const { header, embeddings, artEmbeddings } = decodePack(
    gunzipSync(await readFile(filePath)),
  );

  // Refuse before writing anything. A pack from a different embedding pipeline
  // imports perfectly happily and then makes every match slightly worse, which
  // reads as a bad model rather than a bad catalog.
  const reason = incompatibilityReason({
    model: header.model,
    dtype: header.dtype,
    dim: header.dim,
    preprocessing: header.preprocessing,
    artWindows: header.artWindows,
  });
  if (reason) throw new Error(reason);

  let inserted = 0;
  for (let start = 0; start < header.count; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, header.count);
    const rows = [];
    for (let i = start; i < end; i++) {
      const card = header.cards[i];
      const art = artEmbeddings[i];
      rows.push({
        cardId: card.id,
        gameKey: header.gameKey,
        lang: header.lang,
        name: card.name,
        setCode: card.setCode,
        collectorNumber: card.collectorNumber ?? null,
        setTotal: card.setTotal ?? null,
        cardData: card.data ?? null,
        embedding: Array.from(embeddings[i]),
        embeddingArt: art ? Array.from(art) : null,
      });
    }

    // Upsert the art vector rather than skipping the row outright. Every
    // established install already holds all ~21.7k card ids, so
    // onConflictDoNothing would insert zero rows and leave embedding_art null
    // forever — the pack would download, report success, and change nothing.
    //
    // Only the art column is touched, and only when the pack actually carries
    // one, so re-importing an older pack cannot blank a vector that is already
    // there. Everything else about an existing row is left alone, which is what
    // it has always done.
    const written = await db
      .insert(cardImageVectors)
      .values(rows)
      .onConflictDoUpdate({
        target: cardImageVectors.cardId,
        set: {
          embeddingArt: sql`coalesce(excluded.embedding_art, ${cardImageVectors.embeddingArt})`,
        },
        setWhere: sql`excluded.embedding_art is not null`,
      })
      .returning({ id: cardImageVectors.id });

    inserted += written.length;
    onProgress?.(end, header.count);
  }

  invalidateFacets();
  return { header, inserted };
}

/** How many cards are already embedded for a game/language. */
export async function countCards(
  gameKey: string,
  lang: string,
): Promise<number> {
  return db.$count(
    cardImageVectors,
    and(
      eq(cardImageVectors.gameKey, gameKey),
      eq(cardImageVectors.lang, lang),
    ),
  );
}

/**
 * How many of those still lack an art vector.
 *
 * A catalog imported before pack v4 identifies exactly as well as it always
 * did, so nothing fails — it just never gets the art-blend accuracy, and
 * silently. Surfacing the count is what makes a re-import discoverable.
 */
export async function countMissingArt(
  gameKey: string,
  lang: string,
): Promise<number> {
  return db.$count(
    cardImageVectors,
    and(
      eq(cardImageVectors.gameKey, gameKey),
      eq(cardImageVectors.lang, lang),
      isNull(cardImageVectors.embeddingArt),
    ),
  );
}
