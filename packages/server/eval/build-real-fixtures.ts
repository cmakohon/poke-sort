// Builds an accuracy fixture set from real, human-labelled scanner captures.
//
//   POKE_SORT_DATA_DIR=./.poke-sort-catalog pnpm --filter @poke-sort/server eval:build-real
//
// build-fixtures.ts degrades clean renders into camera-shaped probes; this is
// the other half the profile comment in profiles.ts asks for — the actual
// captures the machine took, labelled by the review screen. A row is usable
// when a human has pinned its truth: `review_verdict = 'correct'` vouches for
// the top candidate, `corrected` carries the truth card outright.
//
// The labels lean heavily toward accepts (the sorter is right most of the
// time), so this set measures "does the pipeline hold up on real glass, glare
// and paper" rather than being a balanced hard-case benchmark. The wrongly
// identified and reviewed cases are the valuable minority — keep reviewing on
// the machine and rebuilding, the set only gets sharper.
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { CAPTURES_DIR } from "../src/config";
import { db } from "../src/db";
import { migrateDatabase } from "../src/db/migrate";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, "fixtures", "pokemon-real");

interface Row extends Record<string, unknown> {
  guid: string;
  capture_path: string;
  flipped_retry: boolean;
  truth_id: string;
  name: string | null;
  set_code: string | null;
  collector_number: string | null;
  set_total: number | null;
}

async function main() {
  await migrateDatabase();
  await mkdir(FIXTURES, { recursive: true });

  // Join the catalog for name/setCode — the manifest shape capture-signals.ts
  // consumes — plus the printed collector number and set total, which
  // eval/ocr-sweep.ts scores its reads against. The sweep used to derive both
  // itself: the number from the card id's last segment (wrong for every promo
  // set, where the id suffix is not what is printed) and the total from the
  // stored candidate list (null whenever the true card fell outside the top
  // 50 — i.e. exactly the embedding-weak probes a band change is meant to
  // rescue, so the metric was blind on the cases under treatment).
  //
  // A truth id missing from the catalog would mean a correction to a card that
  // no longer exists; surface it rather than silently dropping.
  const rows = await db.execute<Row>(sql`
    SELECT se.guid::text AS guid,
           se.capture_path,
           se.flipped_retry,
           truth.id AS truth_id,
           c.name,
           c.set_code,
           c.collector_number,
           c.set_total
    FROM scan_events se
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN se.review_verdict = 'corrected' THEN se.corrected_card_id
        ELSE se.candidates->0->>'id'
      END AS id
    ) truth
    LEFT JOIN cards c ON c.card_id = truth.id
    WHERE se.capture_path IS NOT NULL
      AND (
        (se.review_verdict = 'correct' AND jsonb_array_length(se.candidates) > 0)
        OR (se.review_verdict = 'corrected' AND se.corrected_card_id IS NOT NULL)
      )
    ORDER BY se.created_at
  `);

  const manifest: {
    id: string;
    name: string;
    setCode: string;
    file: string;
    collectorNumber: string | null;
    setTotal: number | null;
  }[] = [];
  let missingImage = 0;

  for (const row of rows.rows) {
    if (!row.set_code) {
      console.warn(`truth ${row.truth_id} not in catalog — skipping ${row.guid}`);
      continue;
    }
    const src = path.join(CAPTURES_DIR, path.basename(row.capture_path));
    // Truth ids repeat (the same card scanned more than once), so files are
    // named by scan guid, and the manifest's `file` is what downstream reads.
    const file = `${row.guid}.jpeg`;
    try {
      if (row.flipped_retry) {
        // The winning identification ran on the 180°-rotated capture; store
        // the fixture the way the winner saw it, since the offline harness
        // has no flip-retry pass of its own.
        await sharp(src).rotate(180).jpeg().toFile(path.join(FIXTURES, file));
      } else {
        await copyFile(src, path.join(FIXTURES, file));
      }
    } catch {
      missingImage++;
      continue;
    }
    manifest.push({
      id: row.truth_id,
      name: row.name ?? row.truth_id,
      setCode: row.set_code,
      file,
      collectorNumber: row.collector_number,
      setTotal: row.set_total,
    });
  }

  await writeFile(
    path.join(FIXTURES, "manifest.json"),
    JSON.stringify(
      {
        generatedFrom: `labelled scan_events captures (${new Date().toISOString()})`,
        cards: manifest,
      },
      null,
      2,
    ),
  );

  const skipped = missingImage > 0 ? ` (${missingImage} captures missing on disk)` : "";
  console.log(`${manifest.length} real-capture probes written to ${FIXTURES}${skipped}`);
  process.exit(0);
}

main();
