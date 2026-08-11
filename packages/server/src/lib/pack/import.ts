import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { cardImageVectors } from "../../db/schema";
import { incompatibilityReason } from "../embedding-identity";
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
  const { header, embeddings } = decodePack(gunzipSync(await readFile(filePath)));

  // Refuse before writing anything. A pack from a different embedding pipeline
  // imports perfectly happily and then makes every match slightly worse, which
  // reads as a bad model rather than a bad catalog.
  const reason = incompatibilityReason({
    model: header.model,
    dtype: header.dtype,
    dim: header.dim,
    preprocessing: header.preprocessing,
  });
  if (reason) throw new Error(reason);

  let inserted = 0;
  for (let start = 0; start < header.count; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, header.count);
    const rows = [];
    for (let i = start; i < end; i++) {
      const card = header.cards[i];
      rows.push({
        scryfallId: card.id,
        gameKey: header.gameKey,
        lang: header.lang,
        name: card.name,
        setCode: card.setCode,
        collectorNumber: card.collectorNumber ?? null,
        setTotal: card.setTotal ?? null,
        cardData: card.data ?? null,
        embedding: Array.from(embeddings[i]),
      });
    }

    const written = await db
      .insert(cardImageVectors)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: cardImageVectors.id });

    inserted += written.length;
    onProgress?.(end, header.count);
  }

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
