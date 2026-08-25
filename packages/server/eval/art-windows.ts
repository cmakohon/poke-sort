// Contact sheets of the art window, one row per series.
//
//   POKE_SORT_MODEL_DIR=../../.models pnpm exec tsx eval/art-windows.ts
//
// Why by eye: art-crop-probe.ts can only measure eras that appear as TRUTH in
// the labelled set, and sv/swsh/sm/ex/ecard/gym/lc never do — they show up
// only as rivals, where a badly cropped rival makes truth win MORE and reads
// as a pass. So the numbers cannot tell those eras apart from a window landing
// on the frame. Looking can.
//
// Writes eval/.artprobe/windows/<serie>.png. Network only, no model, no DB.
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import indexJson from "../src/data/pokemon-set-index.json";
import { artWindowFor, cropArt } from "../src/lib/art-window";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, ".artprobe", "windows");
const CARDS = path.join(here, ".artprobe", "cards");
const PER_SERIES = 5;
const CELL_W = 300;

interface SetInfo {
  id: string;
  serieId: string;
  cardCount: number | null;
  releaseDate: string | null;
}
const sets = Object.values(
  (indexJson as unknown as { sets: Record<string, SetInfo> }).sets,
);

async function render(serie: string, setId: string, localId: number): Promise<Buffer | null> {
  const cache = path.join(CARDS, `${setId}-${localId}.webp`);
  try {
    await access(cache);
    return await sharp(cache).toBuffer();
  } catch {
    /* not cached */
  }
  // sv and me zero-pad the collector number in the asset path ("001", not "1"),
  // older series do not. The catalog stores the real localId per card; this
  // script has no database, so it tries both rather than reconstructing wrong.
  for (const id of [String(localId), String(localId).padStart(3, "0")]) {
    const url = `https://assets.tcgdex.net/en/${serie}/${setId}/${id}/high.webp`;
    const r = await fetch(url).catch(() => null);
    if (!r?.ok) continue;
    const buf = Buffer.from(await r.arrayBuffer());
    await writeFile(cache, buf);
    return buf;
  }
  return null;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(CARDS, { recursive: true });

  const bySerie = new Map<string, SetInfo[]>();
  for (const s of sets) {
    if (!bySerie.has(s.serieId)) bySerie.set(s.serieId, []);
    bySerie.get(s.serieId)!.push(s);
  }

  for (const [serie, members] of bySerie) {
    const window = artWindowFor(serie);
    if (!window) {
      console.log(`${serie.padEnd(6)} no window — skipped`);
      continue;
    }
    // Biggest set first, falling through on a miss: promo sets are often the
    // largest in a series but have no sequential renders to walk.
    const ordered = [...members].sort((a, b) => (b.cardCount ?? 0) - (a.cardCount ?? 0));
    let set = ordered[0];
    let cells: Buffer[] = [];
    for (const candidate of ordered) {
      cells = [];
      for (let i = 1; cells.length < PER_SERIES && i <= PER_SERIES * 4; i++) {
        const buf = await render(serie, candidate.id, i);
        if (!buf) continue;
        try {
          const crop = await cropArt(buf, window);
          cells.push(await sharp(crop).resize({ width: CELL_W }).png().toBuffer());
        } catch {
          /* unreadable render */
        }
      }
      if (cells.length > 0) {
        set = candidate;
        break;
      }
    }
    if (cells.length === 0) {
      console.log(`${serie.padEnd(6)} no renders in ${ordered.length} sets`);
      continue;
    }
    const metas = await Promise.all(cells.map((c) => sharp(c).metadata()));
    const rowH = Math.max(...metas.map((m) => m.height ?? 0));
    const sheet = sharp({
      create: {
        width: CELL_W * cells.length,
        height: rowH,
        channels: 3,
        background: { r: 20, g: 20, b: 20 },
      },
    }).composite(cells.map((input, i) => ({ input, left: i * CELL_W, top: 0 })));
    const file = path.join(OUT, `${serie}.png`);
    await sheet.png().toFile(file);
    console.log(
      `${serie.padEnd(6)} ${set.id.padEnd(14)} ${String(set.releaseDate).slice(0, 4)}  ${cells.length} crops -> ${path.relative(here, file)}`,
    );
  }
}

main();
