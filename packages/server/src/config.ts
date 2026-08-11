import path from "node:path";

/**
 * Everything the app writes lives under one directory so the Electron shell can
 * point it at `app.getPath("userData")` with a single env var (Phase 3).
 */
export const DATA_DIR = path.resolve(process.env.POKE_SORT_DATA_DIR ?? "./.poke-sort");

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
  process.env.POKE_SORT_MIGRATIONS_DIR ?? path.resolve(__dirname, "../../../drizzle");

/**
 * When set, the built SPA is served from this directory and the API becomes
 * same-origin. The desktop shell sets it; `pnpm dev` leaves it unset so Vite
 * keeps serving the app with HMR.
 */
export const STATIC_DIR = process.env.POKE_SORT_STATIC_DIR
  ? path.resolve(process.env.POKE_SORT_STATIC_DIR)
  : null;

/**
 * Port 0 asks the OS for a free port — what the desktop shell wants, since a
 * fixed port could collide with anything else on the machine. The real port is
 * reported back over the utilityProcess message channel.
 */
export const PORT = parseInt(process.env.PORT ?? "3001", 10);

/** Loopback-only in the packaged app; the dev server stays reachable on the LAN
 * so a phone can open the monitor view. */
export const HOST = process.env.POKE_SORT_HOST ?? "0.0.0.0";

/** Where the bundled SigLIP weights live (transformers.js `env.cacheDir`). */
export const MODEL_DIR = process.env.POKE_SORT_MODEL_DIR
  ? path.resolve(process.env.POKE_SORT_MODEL_DIR)
  : null;

/** Refuse to fetch weights from the network — the packaged app ships them. */
export const MODELS_OFFLINE = process.env.POKE_SORT_MODELS_OFFLINE === "1";

/**
 * Refresh the identified card's price from upstream during a scan.
 *
 * On by default: bin rules can route on price, and the routing decision is made
 * the instant a card is identified, so a stale price sorts the card into the
 * wrong bin. Set to "0" for a strictly offline setup, which keeps the prices
 * frozen at whatever the catalog shipped with.
 */
export const LIVE_PRICING = process.env.POKE_SORT_LIVE_PRICING !== "0";

/**
 * How hard the ANN index searches.
 *
 * Measured on the real 21,714-card catalog with degraded probes: 100 returns
 * the same top-1 as an exact scan on every probe (2.9 ms against 71 ms).
 * Above ~200 the planner abandons the index for a sequential scan, so raising
 * this further buys nothing and silently gives up the index.
 */
export const HNSW_EF_SEARCH = parseInt(
  process.env.POKE_SORT_HNSW_EF_SEARCH ?? "100",
  10,
);

/** How long a price lookup may delay a scan before the stored price stands. */
export const PRICE_TIMEOUT_MS = parseInt(
  process.env.POKE_SORT_PRICE_TIMEOUT_MS ?? "2000",
  10,
);
