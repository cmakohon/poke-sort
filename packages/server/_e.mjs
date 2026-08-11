import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
const db = new PGlite("./.poke-sort-catalog/db", { extensions: { vector, pg_trgm } });
// a Diamond & Pearl card whose STORED data has no serie
const r = await db.query(`
  SELECT card_id, card_data FROM cards
  WHERE card_id LIKE 'dp%' AND card_data->'set'->'serie'->>'name' IS NULL
  LIMIT 1`);
await db.close();
const row = r.rows[0];
console.log("  card:", row.card_id, "| stored serie:", row.card_data?.set?.serie?.name ?? "(none)");
const { normalizePokemonCard } = await import("./dist/index.js").catch(() => ({}));
console.log("  --- via the server bundle ---");
process.env.POKE_SORT_DATA_DIR = "./.poke-sort-catalog";
const mod = await import("./src/lib/pokemon/search.ts").catch(e => { console.log("  (ts import unavailable)"); return null; });
