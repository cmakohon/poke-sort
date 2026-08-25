/**
 * Fill embedding_art for a catalog that predates it.
 *
 *   POKE_SORT_DATA_DIR=./.poke-sort-catalog POKE_SORT_MODEL_DIR=../../.models \
 *     pnpm --filter @poke-sort/server backfill:art
 *
 * PGlite is single-process: close the app first, and check with
 * `lsof +D <dataDir>/db` (its output, not its exit code).
 *
 * ~21.7k cards at four concurrent forward passes is about an hour. Resumable —
 * it only ever selects rows still missing a vector, so an interrupted run costs
 * nothing but the batch in flight.
 */
import { and, isNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import { cardImageVectors } from "../src/db/schema";
import { migrateDatabase } from "../src/db/migrate";
import { artWindowForSet, cropArt } from "../src/lib/art-window";
import { vectorizeImageFromBuffer } from "../src/lib/vectorize";

const CONCURRENCY = Number(process.env.VECTORIZE_CONCURRENCY ?? 4);
/**
 * Cards per run, 0 for all of them.
 *
 * The whole catalog is an hour of wall clock, and an hour is a long time to
 * hold a database that allows exactly one opener and has been corrupted by an
 * abrupt exit before. Bounded runs let it be driven in chunks that each finish
 * on their own; resumability makes the chunking free.
 */
const LIMIT = Number(process.env.BACKFILL_LIMIT ?? 0);
const WRITE_BATCH_SIZE = 250;
const FETCH_ATTEMPTS = 4;
const FETCH_BACKOFF_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Same shape as sync-job's image fetch, and for the same reason: a bare fetch
 * at concurrency 4 against the asset CDN failed ~35% of requests within the
 * first thousand cards. 4xx other than 429 is a real "no such image" and is not
 * retried; everything else backs off exponentially with jitter so the workers
 * do not retry in lockstep.
 */
async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if (res.status < 500 && res.status !== 429) {
        throw new Error(`HTTP ${res.status}`);
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < FETCH_ATTEMPTS) {
      const delay = FETCH_BACKOFF_MS * 2 ** (attempt - 1);
      await sleep(delay + Math.floor(Math.random() * delay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

interface Row {
  card_id: string;
  set_code: string;
  card_data: { image?: string } | null;
}

async function main() {
  await migrateDatabase();

  const { rows } = await db.execute<Row>(sql`
    SELECT card_id, set_code, card_data
    FROM cards
    WHERE embedding_art IS NULL
    ORDER BY card_id ASC
  `);

  // Series with no window are not failures and must not be retried forever.
  const withWindow = rows.filter((r) => artWindowForSet(r.set_code) !== null);
  const todo = LIMIT > 0 ? withWindow.slice(0, LIMIT) : withWindow;
  console.log(
    `${rows.length} rows missing an art vector, ${withWindow.length} with a window ` +
      `(${rows.length - withWindow.length} skipped: no window for their series)` +
      (LIMIT > 0 ? `; this run takes ${todo.length}` : ""),
  );
  if (todo.length === 0) return;

  let pending: { cardId: string; embeddingArt: number[] }[] = [];
  let done = 0;
  let errors = 0;
  let noImage = 0;

  // One writer, chained: PGlite is a single connection, so concurrent writes
  // would serialise anyway and interleave badly with the reads.
  async function flush() {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    for (const { cardId, embeddingArt } of batch) {
      await db
        .update(cardImageVectors)
        .set({ embeddingArt })
        .where(
          and(
            sql`${cardImageVectors.cardId} = ${cardId}`,
            isNull(cardImageVectors.embeddingArt),
          ),
        );
    }
  }

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
      for (let i = next++; i < todo.length; i = next++) {
        const row = todo[i];
        const window = artWindowForSet(row.set_code);
        const image = row.card_data?.image;
        // No image URL upstream, so there is nothing to crop — distinct from a
        // fetch that failed, and counted separately so a run that can never
        // make progress does not look like a run that might.
        if (!window || !image) {
          noImage++;
          continue;
        }
        try {
          const res = await fetchWithRetry(`${image}/high.webp`);
          const buffer = Buffer.from(await res.arrayBuffer());
          const embeddingArt = await vectorizeImageFromBuffer(
            await cropArt(buffer, window),
          );
          pending.push({ cardId: row.card_id, embeddingArt });
          if (pending.length >= WRITE_BATCH_SIZE) await flush();
        } catch (err) {
          errors++;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  ${row.card_id}: ${msg}`);
        }
        done++;
        if (done % 250 === 0) {
          console.log(`  ${done}/${todo.length} (${errors} errors)`);
        }
      }
    }),
  );
  await flush();

  const [{ remaining }] = (
    await db.execute<{ remaining: number }>(sql`
      SELECT count(*)::int AS remaining FROM cards WHERE embedding_art IS NULL
    `)
  ).rows;
  console.log(
    `done: ${done} processed, ${errors} fetch errors, ${noImage} with no image ` +
      `upstream, ${remaining} still null`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
