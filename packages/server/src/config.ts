import path from "node:path";

/**
 * Everything the app writes lives under one directory so the Electron shell can
 * point it at `app.getPath("userData")` with a single env var (Phase 3).
 */
export const DATA_DIR = path.resolve(process.env.MAULT_DATA_DIR ?? "./.mault");

/** Embedded Postgres. */
export const DB_DIR = path.join(DATA_DIR, "db");

/**
 * Scan captures, as JPEG files on disk rather than base64 in the database.
 * At ~150 KB a scan, 10k cards is ~1.5 GB — untenable inside a WASM database.
 */
export const CAPTURES_DIR = path.join(DATA_DIR, "captures");

/**
 * Migrations are read from disk at runtime, so this has to resolve for both
 * `tsx src/index.ts` and the bundled `dist/index.js` — both sit three levels
 * below the repo root. Phase 3 will override it: the Electron build ships the
 * folder via extraResources, outside the asar.
 */
export const MIGRATIONS_DIR =
  process.env.MAULT_MIGRATIONS_DIR ?? path.resolve(__dirname, "../../../drizzle");
