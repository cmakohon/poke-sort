import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/pglite/migrator";
import { HNSW_EF_SEARCH, MIGRATIONS_DIR } from "../config";
import { client, db } from ".";

/**
 * Runs pending migrations against the embedded database on boot.
 *
 * The old `/drizzle` folder was ~8 tables out of date because the live schema
 * was maintained with `db:push`; it was deleted and regenerated from zero, so
 * `0000` is the whole schema. It also hand-prepends `CREATE EXTENSION` for
 * vector and pg_trgm — nothing in the repo used to create those, because Neon
 * had enabled them out of band.
 */
export async function migrateDatabase(): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  await reportSkippedMigrations();
  await configureSession();
}

/**
 * Names any migration the migrator declined to run.
 *
 * It applies a migration only when its journal timestamp is strictly greater
 * than the newest `created_at` already recorded — so a migration whose `when`
 * merely TIES the newest row is skipped without a word. That is not exotic:
 * the timestamps here are hand-written, and two branches each writing "the next
 * one" land on the same value (0007_review_bin and 0007_persist_scan_outcome
 * both took 1786500240000). The failure then surfaces at the first query as
 * `column ... does not exist`, pointing at the route rather than at the
 * migration that never ran.
 *
 * A warning rather than a throw: the check is derived from how the migrator
 * hashes files, so a change on that side should not stop a working machine from
 * booting. The message carries the fix — raise the entry's `when` above every
 * other branch's.
 */
async function reportSkippedMigrations(): Promise<void> {
  try {
    const journal = JSON.parse(
      readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf-8"),
    ) as { entries: { when: number; tag: string }[] };

    const applied = await client.query<{ hash: string }>(
      "select hash from drizzle.__drizzle_migrations",
    );
    const seen = new Set(applied.rows.map((r) => r.hash));

    const skipped = journal.entries.filter((entry) => {
      const sql = readFileSync(
        path.join(MIGRATIONS_DIR, `${entry.tag}.sql`),
        "utf-8",
      );
      return !seen.has(createHash("sha256").update(sql).digest("hex"));
    });

    // Every entry looking unapplied means the hash no longer matches how the
    // migrator computes it, not that the database is 8 migrations behind.
    if (skipped.length === 0 || skipped.length === journal.entries.length) return;

    for (const entry of skipped) {
      console.error(
        `[db] Migration ${entry.tag} (when=${entry.when}) is in the journal but was not applied.` +
          " Its timestamp is probably not greater than the newest one already recorded;" +
          " raise it above every `when` on every branch and restart.",
      );
    }
  } catch (err) {
    console.warn("[db] Could not verify applied migrations:", err);
  }
}

/**
 * Session settings that only exist once the vector extension is loaded, which
 * is why they are applied after migrating rather than at connection time.
 *
 * PGlite is a single connection for the life of the process, so setting them
 * once here covers every later query.
 */
export async function configureSession(): Promise<void> {
  await client.exec(`SET hnsw.ef_search = ${HNSW_EF_SEARCH};`);
  // Identify filters by game_key and lang. Without iterative scan, pgvector
  // takes the top ef_search rows by distance and only then applies the filter,
  // so a query for one game can come back short once another game's cards are
  // in the table. Relaxed order keeps recall while still using the index.
  await client.exec("SET hnsw.iterative_scan = relaxed_order;");
}
