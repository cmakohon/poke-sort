// Does embedding the ART WINDOW instead of the whole card separate the
// reprint pairs the whole-card embedding cannot?
//
//   POKE_SORT_MODEL_DIR=../../.models pnpm exec tsx eval/art-crop-probe.ts
//
// Needs the model and the network (it pulls catalog renders from tcgdex), but
// NOT the database — everything it needs about production behaviour is already
// in signals-pokemon-real.json. Images and vectors are cached under
// eval/.artprobe, so a re-run costs only the arithmetic.
//
// Why it exists: hgss identification is the worst in the system (top-1 74.2%
// against pl/dp/bw at ~98.6%) and it is not an OCR problem. The collector
// number work in this branch bought hgss ~3 points; the embedding is where the
// remaining ~25 points live. SigLIP sees a whole card at 224px, where the art
// window is ~100px and the frame dominates, so two printings of one Pokemon
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
// only on order. Blending is what wins. See the plan file for the go/no-go.
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import indexJson from "../src/data/pokemon-set-index.json";
import { POKEMON_PROFILE } from "../src/lib/identify/profiles";
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

/**
 * The art window, as fractions of the card.
 *
 * Measured by cropping renders and looking: holds for dp, hgss, pl and bw,
 * which are the eras with enough labelled captures to say anything about.
 * WOTC-era frames sit higher and modern (sv/me) frames are full-bleed, so
 * those are NOT covered — a shipped version needs either per-era windows or a
 * detector, and that is part of the cost, not a footnote.
 */
const ART = { x0: 0.06, y0: 0.12, x1: 0.94, y1: 0.55 };

const ERAS = ["hgss", "pl", "dp", "bw"] as const;
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

async function artCrop(buf: Buffer): Promise<Buffer> {
  const png = await sharp(buf).png().toBuffer();
  const m = await sharp(png).metadata();
  return sharp(png)
    .extract({
      left: Math.round(ART.x0 * m.width!),
      top: Math.round(ART.y0 * m.height!),
      width: Math.round((ART.x1 - ART.x0) * m.width!),
      height: Math.round((ART.y1 - ART.y0) * m.height!),
    })
    .png()
    .toBuffer();
}

function renderUrl(id: string, localId: string | null): string | null {
  if (!localId) return null;
  const suffix = `-${localId}`;
  const setId = id.endsWith(suffix)
    ? id.slice(0, -suffix.length)
    : id.split("-").slice(0, -1).join("-");
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

async function main() {
  await mkdir(path.join(CACHE, "cards"), { recursive: true });
  const { captures } = JSON.parse(await readFile(SIGNALS, "utf-8")) as {
    captures: Capture[];
  };
  const manifest = JSON.parse(
    await readFile(path.join(FIXTURES, "manifest.json"), "utf-8"),
  ) as { cards: { id: string; file: string; setCode: string }[] };
  const eraOf = (setCode: string) => setCode.replace(/[\d.]+$/, "") || setCode;

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
    if (!ERAS.includes(era as (typeof ERAS)[number])) continue;
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
  console.log(`${pairs.length} pairs across ${ERAS.join("/")}`);

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

  const vecPath = path.join(CACHE, "vectors.json");
  let vec: Record<string, { full: number[]; art: number[] }> = {};
  try {
    vec = JSON.parse(await readFile(vecPath, "utf-8"));
  } catch {
    /* first run */
  }
  const embed = async (key: string, buf: Buffer) => {
    if (vec[key]) return;
    vec[key] = {
      full: await vectorizeImageFromBuffer(await sharp(buf).png().toBuffer()),
      art: await vectorizeImageFromBuffer(await artCrop(buf)),
    };
  };
  for (const id of need.keys()) {
    const f = path.join(CACHE, "cards", `${id.replace(/\//g, "_")}.webp`);
    try {
      await embed(`card:${id}`, await readFile(f));
    } catch {
      /* render missing */
    }
  }
  for (const p of pairs) {
    await embed(`cap:${p.file}`, await readFile(path.join(FIXTURES, p.file)));
  }
  await writeFile(vecPath, JSON.stringify(vec));
  console.log(`vectors: ${Object.keys(vec).length}\n`);

  // Head-to-head under a blend, WITH the OCR signals, because embedding-only
  // numbers overstate the gain — the reranker already rescues some of these.
  const weights = [0, 0.25, 0.5, 0.75, 1];
  console.log("truth beats its rival (OCR signals in play)");
  console.log("art weight  " + ERAS.map((e) => e.padStart(9)).join(""));
  const byFile = new Map(captures.map((c) => [c.file, c]));
  for (const w of weights) {
    const tally: Record<string, { n: number; win: number }> = {};
    for (const p of pairs) {
      const cap = byFile.get(p.file);
      const vc = vec[`cap:${p.file}`];
      const vt = vec[`card:${p.truth.id}`];
      const vr = vec[`card:${p.rival.id}`];
      if (!cap || !vc || !vt || !vr) continue;
      const blend = (card: { art: number[] }, base: number) =>
        w === 0 ? base : (1 - w) * base + w * cos(vc.art, card.art);
      const dT = blend(vt, p.truth.distance);
      const dR = blend(vr, p.rival.distance);
      const t = (tally[p.era] ??= { n: 0, win: 0 });
      t.n++;
      if (fuse(cap, p.truth, dT, p.rival, dR) > fuse(cap, p.rival, dR, p.truth, dT)) {
        t.win++;
      }
    }
    const tag = w === 0 ? "   (production today)" : w === 1 ? "   (art only)" : "";
    console.log(
      String(w).padEnd(12) +
        ERAS.map((e) =>
          (tally[e] ? `${((tally[e].win / tally[e].n) * 100).toFixed(1)}%` : "-").padStart(9),
        ).join("") +
        tag,
    );
  }
  console.log(`\nmanifest cards: ${manifest.cards.length}`);
}

main();
