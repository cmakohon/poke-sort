// Exports the identification index for the DexFlip iOS port.
//
//   POKE_SORT_DATA_DIR=./.poke-sort-catalog pnpm exec tsx ../../dexflip-port/scripts/export-dexflip-index.ts
//   (run from packages/server, with the app CLOSED — PGlite is single-process)
//
// Produces, in dexflip-port/index/:
//   cards.json         one entry per identifiable card, aligned with the vectors
//   embeddings.f16     unit-normalised whole-card vectors, float16, row-major
//   art-embeddings.f16 unit-normalised art-window vectors; zero row = none
//
// Digital-only sets (TCG Pocket) are excluded outright: the sorter excludes
// them at candidate time on every scan, and DexFlip's engine never needs them
// for anything else, so they are pure download weight.
//
// ⚠ The vectors are only comparable to queries embedded by the SAME pipeline
// (Xenova/siglip-base-patch16-512, q8 ONNX, squash-resize 512, [-1,1]
// normalise). A Core ML embedder that is not verified bit-close against it
// needs the catalog re-embedded — see dexflip-port/README.md.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "../../packages/server/src/db";
import { EMBEDDING_IDENTITY } from "../../packages/server/src/lib/embedding-identity";
import { digitalOnlySetIds, getSetInfo, allSets } from "../../packages/server/src/lib/set-index";
import { setIdOf, abbreviationOf, hpOf } from "../../packages/server/src/lib/identify/candidates";
import type { CandidateRow } from "../../packages/server/src/lib/identify/candidates";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index");
const DIM = 768;

function f16(bits: Float32Array): Uint16Array {
  // Round-to-nearest-even float32 -> float16. Unit vectors live in [-1, 1],
  // where half precision carries ~3.3 decimal digits — measured cosine
  // distances change by < 1e-3, far under every gate in the profile.
  const out = new Uint16Array(bits.length);
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  for (let i = 0; i < bits.length; i++) {
    f32[0] = bits[i];
    const x = u32[0];
    const sign = (x >>> 16) & 0x8000;
    let exp = (x >>> 23) & 0xff;
    let mant = x & 0x7fffff;
    if (exp === 0xff) out[i] = sign | 0x7c00 | (mant ? 0x200 : 0);
    else {
      let e = exp - 127 + 15;
      if (e >= 0x1f) out[i] = sign | 0x7c00;
      else if (e <= 0) {
        if (e < -10) out[i] = sign;
        else {
          mant |= 0x800000;
          const shift = 14 - e;
          let m = mant >>> shift;
          if ((mant >>> (shift - 1)) & 1) m++;
          out[i] = sign | m;
        }
      } else {
        let m = mant >>> 13;
        if ((mant >>> 12) & 1) m++;
        out[i] = sign | (e << 10) | m;
        if (m === 0x400) out[i] = sign | ((e + 1) << 10);
      }
    }
  }
  return out;
}

function unit(v: number[]): Float32Array {
  const out = new Float32Array(v);
  let norm = 0;
  for (const x of out) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const excluded = new Set(digitalOnlySetIds());

  const cards: object[] = [];
  const whole: Uint16Array[] = [];
  const art: Uint16Array[] = [];
  const zero = new Uint16Array(DIM);

  let offset = 0;
  for (;;) {
    const { rows } = await db.execute<
      CandidateRow & { embedding: string; embedding_art: string | null }
    >(sql`
      select card_id, name, collector_number, set_total, set_code, card_data,
             embedding::text as embedding, embedding_art::text as embedding_art
      from cards
      where game_key = 'pokemon' and lang = 'en'
      order by card_id
      limit 2000 offset ${offset}
    `);
    if (rows.length === 0) break;
    offset += rows.length;
    for (const row of rows) {
      const setId = setIdOf(row);
      if (excluded.has(setId)) continue;
      const info = getSetInfo(setId);
      cards.push({
        id: row.card_id,
        name: row.name,
        collectorNumber: row.collector_number,
        setTotal: row.set_total,
        hp: hpOf("pokemon", row.card_data),
        // Printed set code, already gated to SwSh-onward — null must stay null.
        setAbbreviation: abbreviationOf("pokemon", row),
        setId,
        setName: info?.name ?? null,
        hasArt: row.embedding_art != null,
      });
      whole.push(f16(unit(JSON.parse(row.embedding))));
      art.push(row.embedding_art ? f16(unit(JSON.parse(row.embedding_art))) : zero);
    }
    console.log(`  ${offset} rows scanned, ${cards.length} kept`);
  }

  const pack = (rows: Uint16Array[]) => {
    const buf = Buffer.alloc(rows.length * DIM * 2);
    rows.forEach((r, i) => buf.set(Buffer.from(r.buffer, 0, DIM * 2), i * DIM * 2));
    return buf;
  };

  // Trustworthy set totals for the negative-inference gate in fusion — the
  // Swift port must not recompute these from cards.json (the index covers 56
  // sets the catalog does not carry).
  const setTotals = [
    ...new Set(
      allSets()
        .map((s) => s.cardCount)
        .filter((c): c is number => c != null && c >= 15),
    ),
  ].sort((a, b) => a - b);

  await writeFile(
    path.join(OUT, "cards.json"),
    JSON.stringify({ identity: EMBEDDING_IDENTITY, dim: DIM, count: cards.length, setTotals, cards }),
  );
  await writeFile(path.join(OUT, "embeddings.f16"), pack(whole));
  await writeFile(path.join(OUT, "art-embeddings.f16"), pack(art));
  console.log(`${cards.length} cards -> ${OUT}`);
  process.exit(0);
}

main();
