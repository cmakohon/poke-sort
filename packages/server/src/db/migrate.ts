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
  await configureSession();
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
