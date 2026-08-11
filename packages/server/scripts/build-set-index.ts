// Regenerates src/data/pokemon-set-index.json from TCGdex.
//
//   pnpm --filter @magic-vault/server build:set-index
//
// A card's embedded `set` object carries id, name and artwork but NOT which
// series it belongs to, and the series cannot be derived from the set id:
// only 175 of 218 set ids start with their series id (wp->base, dv1->bw,
// 2011bw->mc, si1->neo...). So the mapping is fetched once and committed,
// which also keeps it available offline.
//
// Re-run when new sets are released — same cadence as cutting a new pack.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "..", "src", "data", "pokemon-set-index.json");

interface SeriesBrief {
  id: string;
  name: string;
}
interface SetBrief {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  releaseDate?: string;
  cardCount?: { official?: number; total?: number };
  /** Printed beside the collector number on Sword & Shield era cards onward. */
  abbreviation?: { official?: string; localized?: string };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function main() {
  const series = await getJson<SeriesBrief[]>(
    "https://api.tcgdex.net/v2/en/series",
  );

  const sets: Record<string, unknown> = {};
  const seriesOut: Record<string, unknown> = {};

  for (const s of series) {
    const full = await getJson<SeriesBrief & { logo?: string; sets: SetBrief[] }>(
      `https://api.tcgdex.net/v2/en/series/${s.id}`,
    );
    seriesOut[s.id] = {
      id: s.id,
      name: s.name,
      logo: full.logo ?? null,
      setCount: full.sets.length,
    };
    for (const st of full.sets) {
      const detail = await getJson<SetBrief>(
        `https://api.tcgdex.net/v2/en/sets/${st.id}`,
      );
      sets[st.id] = {
        id: st.id,
        name: detail.name ?? st.name,
        serieId: s.id,
        serieName: s.name,
        logo: detail.logo ?? null,
        symbol: detail.symbol ?? null,
        releaseDate: detail.releaseDate ?? null,
        cardCount: detail.cardCount?.official ?? null,
        abbreviation: detail.abbreviation?.official ?? null,
      };
    }
    console.log(`  ${s.name}: ${full.sets.length} sets`);
  }

  await writeFile(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        series: seriesOut,
        sets,
      },
      null,
      2,
    ),
  );
  console.log(
    `\n${Object.keys(seriesOut).length} series, ${Object.keys(sets).length} sets -> ${OUT}`,
  );
  process.exit(0);
}

main();
