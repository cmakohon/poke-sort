// Does embedding the ART WINDOW instead of the whole card separate the
// reprint pairs the whole-card embedding cannot?
//
//   POKE_SORT_MODEL_DIR=../../.models pnpm exec tsx eval/art-crop-probe.ts
//
// ART_MODE selects which window assignment to measure:
//   table     (default) whatever src/lib/art-window.ts says
//   universal every series gets the framed window
//   four      only dp/hgss/pl/bw get one; every other series is whole-card
//
// Needs the model and the network (it pulls catalog renders from tcgdex), but
// NOT the database — everything it needs about production behaviour is already
// in signals-pokemon-real.json. Images and vectors are cached under
// eval/.artprobe, so a re-run costs only the arithmetic.
//
// Why it exists: hgss identification is the worst in the system (top-1 74.2%
// against pl/dp/bw at ~98.6%) and it is not an OCR problem. The collector
// number work in this branch bought hgss ~3 points; the embedding is where the
// remaining ~25 points live. SigLIP sees a whole card at 512px, where the art
// window is ~220px and the frame dominates, so two printings of one Pokemon
// with different art land ~0.02 apart — inside the margin gate.
//
// Result, 2026-08-25, 961 labelled captures over a 1254-card pool:
//
//   embedding-only top-1     hgss    pl     dp     bw    weighted
//     whole card             69.1%  99.2%  99.1%  98.2%   95.94%
//     art crop only          96.9%  95.7%  97.2%  94.5%   95.94%
//     blend 0.75/0.25        93.8%  99.0%  97.2%  98.2%   97.92%
//
// Replacing is a wash — the crop moves accuracy from pl/dp/bw to hgss and top-5
// is ~100% either way, so the two views retrieve the same cards and disagree
// only on order. Blending is what wins.
//
// The SAME/CROSS split below is why the shipped table has no null entries: a
// null window and a whole-card window are the same arithmetic, so a card
// without an art vector is scored on a different scale than one with it, and
// the deciding rival is cross-series far too often for that to be safe.
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import indexJson from "../src/data/pokemon-set-index.json";
import { artWindowFor, artWindowKey, cropArt } from "../src/lib/art-window";
import { POKEMON_PROFILE } from "../src/lib/identify/profiles";
import type { OcrRegion } from "../src/lib/identify/profiles";
import {
  ALL_SIGNALS,
  collectorNumberMatch,
  nameSimilarity,
  rerank,
  setAbbreviationMatch,
  setTotalMatch,
  type RerankInput,
} from "../src/lib/identify/rerank";
import { vectorizeImageFromBuffer } from "../src/lib/vectorize";

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(here, ".artprobe");
const FIXTURES = path.join(here, "fixtures", "pokemon-real");
const SIGNALS = path.join(here, "signals-pokemon-real.json");
const sets = (indexJson as unknown as {
  sets: Record<string, { serieId: string }>;
}).sets;

const FRAMED: OcrRegion = { x0: 0.06, y0: 0.12, x1: 0.94, y1: 0.55 };
const MEASURED_ERAS = ["hgss", "pl", "dp", "bw"] as const;
const MODE = (process.env.ART_MODE ?? "table") as "table" | "universal" | "four";
// ART_ERAS=all widens the capture filter past the four eras with enough
// labelled data to be conclusive. The small eras cannot settle anything on
// their own, but "did base/xy/me get worse" is exactly the question a universal
// window raises, and silence is not an answer.
const ALL_ERAS = process.env.ART_ERAS === "all";
/** Eras worth a column; the rest are folded into the `all` total. */
const MIN_ERA_N = 10;
const CUT = POKEMON_PROFILE.distanceCutoff;
const W = POKEMON_PROFILE.weights;

/** Matches pgvector's `<=>`. */
function cos(a: number[], b: number[]): number {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return 1 - d / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Card id minus its collector-number suffix. Promo sets need the suffix form. */
function setIdOf(id: string, localId: string | null): string {
  const suffix = `-${localId}`;
  return localId && id.endsWith(suffix)
    ? id.slice(0, -suffix.length)
    : id.split("-").slice(0, -1).join("-");
}

function serieOf(c: RerankInput): string | null {
  return sets[setIdOf(c.id, c.collectorNumber)]?.serieId ?? null;
}

/** The window this candidate is cropped to under the mode being measured. */
function windowOf(c: RerankInput): OcrRegion | null {
  const serie = serieOf(c);
  if (!serie) return null;
  if (MODE === "universal") return FRAMED;
  if (MODE === "four") {
    return (MEASURED_ERAS as readonly string[]).includes(serie) ? FRAMED : null;
  }
  return artWindowFor(serie);
}

function renderUrl(id: string, localId: string | null): string | null {
  if (!localId) return null;
  const setId = setIdOf(id, localId);
  const serie = sets[setId]?.serieId;
  return serie
    ? `https://assets.tcgdex.net/en/${serie}/${setId}/${localId}/high.webp`
    : null;
}

interface Capture {
  file: string;
  expectedId: string;
  setCode: string;
  ocr: Record<string, unknown>;
  candidates: RerankInput[];
}

/** Fuse exactly as rerank does, but with the embedding term supplied. */
function fuse(cap: Capture, c: RerankInput, d: number, other: RerankInput, dOther: number) {
  const mk = (cc: RerankInput, dd: number) => ({
    embedding: Math.max(0, Math.min(1, 1 - dd / CUT)),
    name: nameSimilarity(cap.ocr.name as string | undefined, cc.name),
    collectorNumber: collectorNumberMatch(cap.ocr, cc),
    setAbbreviation: setAbbreviationMatch(cap.ocr, cc),
    setTotal: setTotalMatch(cap.ocr, cc),
    hp: cap.ocr.hp != null && cc.hp != null && cap.ocr.hp === cc.hp ? 1 : 0,
  });
  const s = mk(c, d);
  const o = mk(other, dOther);
  // A signal counts only if it separates the two, mirroring informativeSignals.
  const inf = ALL_SIGNALS.filter((k) => k === "embedding" || s[k] > 0 || o[k] > 0);
  let mass = 0;
  let total = 0;
  for (const k of inf) {
    mass += W[k];
    total += W[k] * s[k];
  }
  return mass > 0 ? total / mass : 0;
}

/**
 * Vector cache, keyed by window so several assignments can share one file.
 *
 * v1 stored `{ [key]: { full, art } }` with `art` always the framed window;
 * it is migrated in place rather than thrown away, because refilling it is
 * ~1750 forward passes.
 */
interface Cache {
  full: Record<string, number[]>;
  art: Record<string, number[]>;
}

async function loadCache(file: string): Promise<Cache> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf-8"));
  } catch {
    return { full: {}, art: {} };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.full && obj.art) return obj as unknown as Cache;
  const framed = artWindowKey(FRAMED);
  const cache: Cache = { full: {}, art: {} };
  const v1 = obj as Record<string, { full?: number[]; art?: number[] }>;
  for (const [key, value] of Object.entries(v1)) {
    if (value?.full) cache.full[key] = value.full;
    if (value?.art) cache.art[`${key}|${framed}`] = value.art;
  }
  console.log(`migrated ${Object.keys(cache.full).length} cached vectors to v2`);
  return cache;
}

async function main() {
  await mkdir(path.join(CACHE, "cards"), { recursive: true });
  const { captures } = JSON.parse(await readFile(SIGNALS, "utf-8")) as {
    captures: Capture[];
  };
  const eraOf = (setCode: string) => setCode.replace(/[\d.]+$/, "") || setCode;
  console.log(`mode: ${MODE}\n`);

  // Pair each capture with the card its truth has to beat: whatever production
  // ranks above it, or the runner-up when production already has it right.
  //
  // Production's own `rerank`, not a local copy — the informative-signal mask
  // is a property of the whole candidate set, so scoring a candidate against
  // itself gets a different (and wrong) answer. That slip put the art-weight-0
  // baseline at 75.3% when production measures 74.2%.
  const byId = (cap: Capture) => new Map(cap.candidates.map((c) => [c.id, c]));
  const pairs: { file: string; era: string; truth: RerankInput; rival: RerankInput }[] = [];
  for (const cap of captures) {
    const era = eraOf(cap.setCode);
    if (!ALL_ERAS && !MEASURED_ERAS.includes(era as (typeof MEASURED_ERAS)[number])) {
      continue;
    }
    const ranked = rerank(cap.candidates, cap.ocr, POKEMON_PROFILE);
    const i = ranked.findIndex((x) => x.id === cap.expectedId);
    if (i < 0) continue;
    const rivalRanked = i === 0 ? ranked[1] : ranked[0];
    if (!rivalRanked) continue;
    const lookup = byId(cap);
    const truth = lookup.get(ranked[i].id);
    const rival = lookup.get(rivalRanked.id);
    if (truth && rival) pairs.push({ file: cap.file, era, truth, rival });
  }
  const eraN: Record<string, number> = {};
  for (const p of pairs) eraN[p.era] = (eraN[p.era] ?? 0) + 1;
  const ERAS = Object.keys(eraN)
    .filter((e) => eraN[e] >= MIN_ERA_N)
    .sort((a, b) => eraN[b] - eraN[a]);
  console.log(`${pairs.length} pairs across ${ERAS.map((e) => `${e}:${eraN[e]}`).join(" ")}`);

  const sameSerie = pairs.filter((p) => serieOf(p.truth) === serieOf(p.rival)).length;
  console.log(
    `deciding rival: ${sameSerie} same-series, ${pairs.length - sameSerie} cross-series`,
  );

  // Fetch every render we need, then embed both views of everything.
  const need = new Map<string, string>();
  for (const p of pairs) {
    for (const s of [p.truth, p.rival]) {
      const u = renderUrl(s.id, s.collectorNumber);
      if (u) need.set(s.id, u);
    }
  }
  let fetched = 0;
  const entries = [...need.entries()];
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let i = next++; i < entries.length; i = next++) {
        const [id, url] = entries[i];
        const out = path.join(CACHE, "cards", `${id.replace(/\//g, "_")}.webp`);
        try {
          await access(out);
          continue;
        } catch {
          /* not cached */
        }
        const r = await fetch(url).catch(() => null);
        if (!r?.ok) continue;
        await writeFile(out, Buffer.from(await r.arrayBuffer()));
        fetched++;
      }
    }),
  );
  console.log(`renders: ${need.size} needed, ${fetched} newly fetched`);

  // Every distinct window any candidate asks for. The capture's era is unknown
  // at scan time, so the capture is cropped to each of them.
  const windowByCard = new Map<string, OcrRegion>();
  const windows = new Map<string, OcrRegion>();
  for (const p of pairs) {
    for (const s of [p.truth, p.rival]) {
      const w = windowOf(s);
      if (!w) continue;
      windowByCard.set(s.id, w);
      windows.set(artWindowKey(w), w);
    }
  }
  console.log(`windows in play: ${windows.size}`);

  const vecPath = path.join(CACHE, "vectors.json");
  const vec = await loadCache(vecPath);
  let embedded = 0;
  const embedFull = async (key: string, buf: Buffer) => {
    if (vec.full[key]) return;
    vec.full[key] = await vectorizeImageFromBuffer(await sharp(buf).png().toBuffer());
    embedded++;
  };
  const embedArt = async (key: string, buf: Buffer, w: OcrRegion) => {
    const k = `${key}|${artWindowKey(w)}`;
    if (vec.art[k]) return;
    vec.art[k] = await vectorizeImageFromBuffer(await cropArt(buf, w));
    embedded++;
  };

  for (const id of need.keys()) {
    const f = path.join(CACHE, "cards", `${id.replace(/\//g, "_")}.webp`);
    try {
      const buf = await readFile(f);
      await embedFull(`card:${id}`, buf);
      // Only the window this card's own series asks for.
      const w = windowByCard.get(id);
      if (w) await embedArt(`card:${id}`, buf, w);
    } catch {
      /* render missing */
    }
  }
  for (const p of pairs) {
    const buf = await readFile(path.join(FIXTURES, p.file));
    await embedFull(`cap:${p.file}`, buf);
    for (const w of windows.values()) await embedArt(`cap:${p.file}`, buf, w);
  }
  await writeFile(vecPath, JSON.stringify(vec));
  console.log(
    `vectors: ${Object.keys(vec.full).length} full, ${Object.keys(vec.art).length} art (${embedded} new)`,
  );

  // Head-to-head under a blend, WITH the OCR signals, because embedding-only
  // numbers overstate the gain — the reranker already rescues some of these.
  const weights = [0, 0.25, 0.5, 0.75, 1];
  const byFile = new Map(captures.map((c) => [c.file, c]));

  // A candidate with no window is scored on its raw distance, which is what
  // production does when the catalog has no art vector for it.
  const blended = (c: RerankInput, capFile: string, w: number): number => {
    if (w === 0) return c.distance;
    const win = windowOf(c);
    if (!win) return c.distance;
    const wk = artWindowKey(win);
    const cardArt = vec.art[`card:${c.id}|${wk}`];
    const capArt = vec.art[`cap:${capFile}|${wk}`];
    if (!cardArt || !capArt) return c.distance;
    return (1 - w) * c.distance + w * cos(capArt, cardArt);
  };

  const report = (label: string, subset: typeof pairs) => {
    console.log(`\n${label} (n=${subset.length}) — truth beats its rival`);
    console.log("art weight  " + ERAS.map((e) => e.padStart(9)).join("") + "      all");
    for (const w of weights) {
      const tally: Record<string, { n: number; win: number }> = {};
      let n = 0;
      let win = 0;
      for (const p of subset) {
        const cap = byFile.get(p.file);
        if (!cap) continue;
        const dT = blended(p.truth, p.file, w);
        const dR = blended(p.rival, p.file, w);
        const t = (tally[p.era] ??= { n: 0, win: 0 });
        t.n++;
        n++;
        if (fuse(cap, p.truth, dT, p.rival, dR) > fuse(cap, p.rival, dR, p.truth, dT)) {
          t.win++;
          win++;
        }
      }
      const tag = w === 0 ? "   (production today)" : w === 1 ? "   (art only)" : "";
      console.log(
        String(w).padEnd(12) +
          ERAS.map((e) =>
            (tally[e] ? `${((tally[e].win / tally[e].n) * 100).toFixed(1)}%` : "-").padStart(9),
          ).join("") +
          (n ? `${((win / n) * 100).toFixed(1)}%` : "-").padStart(9) +
          tag,
      );
    }
  };

  report("ALL PAIRS", pairs);
  report("SAME-SERIES RIVAL", pairs.filter((p) => serieOf(p.truth) === serieOf(p.rival)));
  report("CROSS-SERIES RIVAL", pairs.filter((p) => serieOf(p.truth) !== serieOf(p.rival)));
}

main();
