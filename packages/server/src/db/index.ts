import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { DB_DIR } from "../config";
import * as schema from "./schema";

// PGlite creates its own data directory but not the parents, so a first run
// with a nested POKE_SORT_DATA_DIR would fail on ENOENT.
mkdirSync(DB_DIR, { recursive: true });

// Constructor rather than the `PGlite.create()` factory: the tsup build targets
// CJS/es2020, where a top-level await is a build error. PGlite initialises
// lazily and every query waits on readiness, so this is equivalent here.
export const client = new PGlite(DB_DIR, {
  extensions: { vector, pg_trgm },
});

export const db = drizzle(client, { schema });

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * @deprecated Row-level security is gone with the multi-tenant model, so the
 * claims argument is inert — isolation now comes solely from the explicit
 * `eq(table.orgId, orgId)` predicates the routes already carry. Kept so the
 * ~40 call sites do not have to change; collapse them opportunistically.
 */
export async function authQuery<T>(
  _jwtClaims: string,
  callback: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(callback);
}
