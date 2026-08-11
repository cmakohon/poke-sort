// Measures HNSW recall against the real Pokemon catalog.
//
// The Phase 0 spike could not answer this: it used uniformly random 768-dim
// vectors, where every point is near-equidistant from every other (the top-50
// spanned 4.7% of the nearest distance), so "recall" measured tie-breaking
// among statistical ties. Real SigLIP embeddings cluster, which is the property
// HNSW exploits — so this has to run against the real catalog.
//
// Probes are the LOW-quality render of a real card, embedded fresh. That is a
// genuinely different image of the same card (measured ~0.042 away, versus
// ~0.165 to a different card), so it is a realistic query rather than the
// degenerate self-lookup a catalog vector would give.
//
// Run with the catalog data dir and the server stopped — PGlite is one process:
//
//   MAULT_DATA_DIR=./.mault-catalog MAULT_MODEL_DIR=../../.models \
//     pnpm --filter @magic-vault/server eval:hnsw
import { sql } from "drizzle-orm";
import { client, db } from "../src/db";
import { cardImageVectors } from "../src/db/schema";
import { vectorizeImageFromBuffer } from "../src/lib/vectorize";

const K = 50; // the re-rank window Phase 4a opened up
const PROBES = Number(process.env.PROBES ?? "60");
const EF_VALUES = [40, 100, 200, 400];

interface Probe {
  id: string;
  vector: string;
}

const vecLiteral = (v: number[]) => `[${v.join(",")}]`;

async function topK(vector: string, k = K): Promise<string[]> {
  const res = await db.execute<{ scryfall_id: string }>(sql`
    SELECT scryfall_id
    FROM cards
    ORDER BY embedding <=> ${vector}::vector(768)
    LIMIT ${k}
  `);
  return res.rows.map((r) => r.scryfall_id);
}

async function timedTopK(vector: string): Promise<{ ids: string[]; ms: number }> {
  const t0 = performance.now();
  const ids = await topK(vector);
  return { ids, ms: performance.now() - t0 };
}

const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function main() {
  const total = await db.$count(cardImageVectors);
  console.log(`catalog: ${total} cards\n`);

  // ── build the probe set ────────────────────────────────────────────────
  const sample = await db.execute<{ scryfall_id: string; card_data: unknown }>(sql`
    SELECT scryfall_id, card_data
    FROM cards
    WHERE card_data IS NOT NULL
    ORDER BY scryfall_id
  `);
  // Evenly spaced across the id-sorted catalog, so probes span every era
  // rather than clustering in whichever sets happen to sort first.
  const step = Math.max(1, Math.floor(sample.rows.length / PROBES));
  const picked = sample.rows.filter((_, i) => i % step === 0).slice(0, PROBES);

  console.log(`embedding ${picked.length} low-quality probes...`);
  const probes: Probe[] = [];
  for (const row of picked) {
    const image = (row.card_data as { image?: string } | null)?.image;
    if (!image) continue;
    try {
      const res = await fetch(`${image}/low.webp`);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      probes.push({
        id: row.scryfall_id,
        vector: vecLiteral(await vectorizeImageFromBuffer(buf)),
      });
    } catch {
      /* skip unreachable images */
    }
  }
  console.log(`  ${probes.length} probes ready\n`);

  // ── ground truth: exact scan, index disabled ───────────────────────────
  // Session-level SET, not SET LOCAL: outside a transaction SET LOCAL is a
  // no-op, which silently made the Phase 0 "exact" baseline use the index too.
  await client.exec("SET enable_indexscan = off; SET enable_indexonlyscan = off;");
  const truth: string[][] = [];
  const exactMs: number[] = [];
  for (const p of probes) {
    const { ids, ms } = await timedTopK(p.vector);
    truth.push(ids);
    exactMs.push(ms);
  }
  const exactTop1 = probes.filter((p, i) => truth[i][0] === p.id).length;
  console.log(
    `exact scan   : p50 ${median(exactMs).toFixed(0)}ms  ` +
      `true card ranked #1 for ${exactTop1}/${probes.length}`,
  );

  // ── build the index ────────────────────────────────────────────────────
  await client.exec("SET enable_indexscan = on; SET enable_indexonlyscan = on;");
  console.log("\nbuilding HNSW index...");
  const t0 = performance.now();
  await client.exec(
    "CREATE INDEX IF NOT EXISTS cards_embedding_hnsw ON cards USING hnsw (embedding vector_cosine_ops)",
  );
  console.log(`  built in ${((performance.now() - t0) / 1000).toFixed(0)}s`);

  const plan = await db.execute<{ "QUERY PLAN": string }>(sql`
    EXPLAIN SELECT scryfall_id FROM cards
    ORDER BY embedding <=> ${probes[0].vector}::vector(768) LIMIT ${K}
  `);
  const usesIndex = plan.rows.some((r) => /hnsw/i.test(r["QUERY PLAN"]));
  console.log(`  query uses the index: ${usesIndex}\n`);

  // ── recall ─────────────────────────────────────────────────────────────
  console.log(
    "ef_search".padEnd(10),
    "recall@50".padStart(10),
    "recall@10".padStart(10),
    "top-1 kept".padStart(11),
    "p50".padStart(7),
  );
  for (const ef of EF_VALUES) {
    await client.exec(`SET hnsw.ef_search = ${ef};`);
    let sum50 = 0;
    let sum10 = 0;
    let top1Kept = 0;
    const times: number[] = [];

    for (let i = 0; i < probes.length; i++) {
      const { ids, ms } = await timedTopK(probes[i].vector);
      times.push(ms);
      const t50 = new Set(truth[i]);
      const t10 = new Set(truth[i].slice(0, 10));
      sum50 += ids.filter((id) => t50.has(id)).length / t50.size;
      sum10 += ids.slice(0, 10).filter((id) => t10.has(id)).length / t10.size;
      // The metric that actually matters: does the ANN path still put the same
      // card first as the exact scan would?
      if (ids[0] === truth[i][0]) top1Kept++;
    }

    console.log(
      String(ef).padEnd(10),
      `${((sum50 / probes.length) * 100).toFixed(1)}%`.padStart(10),
      `${((sum10 / probes.length) * 100).toFixed(1)}%`.padStart(10),
      `${top1Kept}/${probes.length}`.padStart(11),
      `${median(times).toFixed(1)}ms`.padStart(7),
    );
  }

  await client.exec("DROP INDEX IF EXISTS cards_embedding_hnsw;");
  console.log("\n(index dropped; nothing persisted)");
  process.exit(0);
}

main();
