import { migrate } from "drizzle-orm/pglite/migrator";
import { MIGRATIONS_DIR } from "../config";
import { db } from ".";

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
}
