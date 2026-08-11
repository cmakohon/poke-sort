// Per-stage identify latency across the fixture set.
//
//   POKE_SORT_DATA_DIR=./.poke-sort-catalog pnpm exec tsx eval/latency.ts
//
// The requirement is a hard 2 seconds per card. This measures where the time
// goes, per stage and per fixture, so optimisation is aimed rather than
// guessed — and so the escalation path's cost is visible separately from the
// happy path it only runs on.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrateDatabase } from "../src/db/migrate";
import { identifyCard } from "../src/lib/identify";
import { disposeOcr } from "../src/lib/identify/ocr";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, "fixtures", "pokemon");

const q = (arr: number[], f: number) =>
  [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * f))];
const fmt = (arr: number[]) =>
  `p50=${q(arr, 0.5)}ms p95=${q(arr, 0.95)}ms max=${Math.max(...arr)}ms`;

async function main() {
  await migrateDatabase();
  const manifest = JSON.parse(
    await readFile(path.join(FIXTURES, "manifest.json"), "utf-8"),
  ) as { cards: { id: string; file: string }[] };

  // The real entry point, concurrency and retry included. Live pricing is
  // disabled by the caller so this measures our code, not TCGdex's day.
  const totals: number[] = [];
  let warm = false;

  for (const f of manifest.cards) {
    const buf = await readFile(path.join(FIXTURES, f.file));
    const t0 = performance.now();
    await identifyCard(buf, "pokemon", "en");
    const ms = Math.round(performance.now() - t0);
    if (!warm) {
      console.log(`cold start: ${ms}ms (model + worker pool load)`);
      warm = true;
      continue;
    }
    totals.push(ms);
  }

  console.log(`n=${totals.length} (warm, through identifyCard)`);
  console.log(`TOTAL: ${fmt(totals)}`);
  const over = totals.filter((x) => x > 2000).length;
  console.log(`over 2000ms: ${over}/${totals.length}`);
  await disposeOcr();
  process.exit(0);
}

main();
