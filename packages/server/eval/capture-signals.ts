// Captures the identify pipeline's intermediate state for every fixture, so
// weights and gate rules can be tuned offline.
//
//   POKE_SORT_DATA_DIR=./.poke-sort-catalog pnpm eval:capture
//
// A full eval run costs ~3 minutes, nearly all of it in the embedding forward
// pass and OCR — neither of which changes when a weight does. This dumps what
// they produced (the OCR reading, and every candidate as the re-ranker sees it)
// to JSON once; eval/tune.ts then replays fusion and gating variants against
// the dump in milliseconds.
//
// Candidates are stored as raw RerankInputs rather than computed signals, so
// the tuner can also try alternative *matching* rules, not just weights.
import { writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../src/db";
import { migrateDatabase } from "../src/db/migrate";
import {
  buildRerankInputs,
  fetchCandidates,
} from "../src/lib/identify";
import { disposeOcr, readCard } from "../src/lib/identify/ocr";
import { POKEMON_PROFILE } from "../src/lib/identify/profiles";
import { vectorizeImageFromBuffer } from "../src/lib/vectorize";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, "fixtures", "pokemon");
const OUT = path.join(here, "signals.json");

async function main() {
  await migrateDatabase();
  const manifest = JSON.parse(
    await readFile(path.join(FIXTURES, "manifest.json"), "utf-8"),
  ) as { cards: { id: string; file: string; setCode: string }[] };

  const captures = [];
  let done = 0;
  for (const fixture of manifest.cards) {
    const buf = await readFile(path.join(FIXTURES, fixture.file));
    const embedding = await vectorizeImageFromBuffer(buf);
    const rows = await fetchCandidates(
      embedding,
      "pokemon",
      "en",
      POKEMON_PROFILE.candidateLimit,
      POKEMON_PROFILE.distanceCutoff,
      POKEMON_PROFILE.excludedSetIds,
    );
    const ocr = POKEMON_PROFILE.ocr
      ? await readCard(buf, POKEMON_PROFILE.ocr).catch(() => ({}))
      : {};

    captures.push({
      expectedId: fixture.id,
      setCode: fixture.setCode,
      ocr,
      candidates: buildRerankInputs(rows, "pokemon"),
    });
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${manifest.cards.length}`);
  }

  await writeFile(OUT, JSON.stringify({ captures }, null, 1));
  console.log(`${captures.length} captures -> ${OUT}`);
  await disposeOcr();
  process.exit(0);
}

main();
