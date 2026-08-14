import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { DATA_DIR, DB_DIR } from "../config";
import { acquireDataDirLock, DataDirBusyError } from "./data-dir-lock";
import * as schema from "./schema";

// PGlite creates its own data directory but not the parents, so a first run
// with a nested POKE_SORT_DATA_DIR would fail on ENOENT.
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(DB_DIR, { recursive: true });

// Before PGlite touches the directory, not after: a second opener corrupts the
// WAL silently, and the damage only surfaces on the next cold start. Here
// rather than in index.ts because this module is what opens the database —
// every entry point that imports it, including the one-off scripts, gets the
// same protection without having to remember.
//
// Handled here rather than rethrown because this runs during module
// evaluation, before any caller's try/catch or promise chain exists. Printing
// the message and exiting is the only way to fail legibly from this position;
// a rethrow surfaces as an uncaught exception with the guidance buried in a
// stack trace, which is exactly the failure mode this exists to end.
export const dataDirLock = (() => {
  try {
    return acquireDataDirLock(DATA_DIR, DB_DIR);
  } catch (err) {
    if (err instanceof DataDirBusyError) {
      console.error(`\n${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
})();

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
