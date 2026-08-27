// Finds mislabeled fixtures by disagreeing with the ground truth on purpose.
//
//   pnpm exec tsx eval/label-audit.ts                  # defaults to vision-fullcard
//   EVAL_FIXTURES=pokemon-real pnpm exec tsx eval/label-audit.ts vision-raw
//
// Written after the 2026-08-27 Vision sweep, where all 12 of the arm's
// WRONG_FULL rows turned out to be mislabeled fixtures rather than misreads —
// including dp2-113 -> dp3-120, the false accept cited in profiles.ts and
// ocr.ts as the reason two separate band widenings were rejected. The capture
// is Night Maintenance 120/132 (Secret Wonders). It was never a false accept.
//
// The method only works with a recogniser materially better than the one the
// labels were collected under. When OCR reads the printed number off ~90% of
// captures, a read that names a DIFFERENT REAL CARD is more likely to be a bad
// label than a bad read — so the disagreements become an audit queue.
//
// What it cannot find: a capture whose label is wrong in a way the printed
// number agrees with, and a capture the recogniser cannot read at all. This
// nominates rows for a human to look at. It does not decide anything.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVAL_SET, FIXTURES_DIR } from "./eval-set";

const DUMP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), ".sweep");

interface Row {
  file: string;
  id: string;
  era: string;
  parsedNum: string | null;
  parsedTotal: number | null;
}
interface ManifestCard {
  id: string;
  file?: string;
  collectorNumber?: string | null;
  setTotal?: number | null;
}

const strip = (v: string | number) => String(v).replace(/^0+(?=\d)/, "");

/**
 * Whether two denominators differ only cosmetically — one substituted digit, a
 * transposition, or a truncation. Those are how a misread fails; naming an
 * unrelated set is how a mislabel looks.
 */
function nearMiss(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return a.startsWith(b) || b.startsWith(a);
  const diff = [...a].filter((ch, i) => ch !== b[i]).length;
  return diff <= 1 || [...a].sort().join("") === [...b].sort().join("");
}

async function main() {
  const label = process.argv[2] ?? "vision-fullcard";
  const dump = path.join(DUMP_DIR, `${EVAL_SET}-${label}.jsonl`);
  const [rowsRaw, manifestRaw] = await Promise.all([
    readFile(dump, "utf-8").catch(() => {
      throw new Error(`no dump for "${label}" — run eval/ocr-sweep.ts first (${dump})`);
    }),
    readFile(path.join(FIXTURES_DIR, "manifest.json"), "utf-8"),
  ]);
  const rows = rowsRaw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row);
  const byId = new Map(
    (JSON.parse(manifestRaw) as { cards: ManifestCard[] }).cards.map((c) => [c.id, c]),
  );

  let read = 0, agree = 0, numOnly = 0, denomOnly = 0;
  type Suspect = Row & { printed: string; got: string };
  const suspects: Suspect[] = [];
  // Both halves differ but the denominator is a digit slip away. Lower
  // confidence than `suspects` and NOT optional to look at: dp2-113 -> dp3-120
  // (123 against 132, a transposition) and neo3-15 -> base3-16 (64 against 62)
  // both land here, and both are mislabels. An earlier cut of this file folded
  // this bucket into the digit-slip count and hid the very finding that
  // motivated the tool.
  const nearSuspects: Suspect[] = [];

  for (const row of rows) {
    if (row.parsedTotal == null || row.parsedNum == null) continue;
    const card = byId.get(row.id);
    if (!card?.collectorNumber || card.setTotal == null) continue;
    read++;
    const numMatch = strip(card.collectorNumber) === strip(row.parsedNum);
    const totalMatch = card.setTotal === row.parsedTotal;
    if (numMatch && totalMatch) { agree++; continue; }
    if (numMatch) { denomOnly++; continue; }
    if (totalMatch) { numOnly++; continue; }
    // Both halves disagree. A misread mangles one number; reading a different
    // card's number in full is what a wrong label looks like. The near-miss
    // filter keeps digit slips and truncations out of the queue.
    const entry: Suspect = {
      ...row,
      printed: `${card.collectorNumber}/${card.setTotal}`,
      got: `${strip(row.parsedNum)}/${row.parsedTotal}`,
    };
    if (nearMiss(String(card.setTotal), String(row.parsedTotal))) nearSuspects.push(entry);
    else suspects.push(entry);
  }

  console.log(`${EVAL_SET} / ${label}: ${read} captures with a full printed number\n`);
  console.log(`  agrees with the label            ${agree}`);
  console.log(`  numerator differs only           ${numOnly}`);
  console.log(`  denominator differs only         ${denomOnly}  (digit slips, truncations)`);
  console.log(`  NAMES A DIFFERENT CARD           ${suspects.length}  <- audit these`);
  console.log(`  ...and with a near-miss total    ${nearSuspects.length}  <- audit these too\n`);

  const table = (title: string, list: Suspect[]) => {
    if (list.length === 0) return;
    console.log(`${title}`);
    console.log(`${"labelled".padEnd(14)}${"era".padEnd(7)}${"printed".padStart(10)}${"read".padStart(11)}   capture`);
    for (const s of [...list].sort((a, b) => a.id.localeCompare(b.id))) {
      console.log(
        `${s.id.padEnd(14)}${s.era.padEnd(7)}${s.printed.padStart(10)}${s.got.padStart(11)}   ${s.file}`,
      );
    }
    console.log();
  };
  table("Read names a different card:", suspects);
  table("Both halves differ, denominator is a near miss:", nearSuspects);
  console.log(
    `${new Set([...suspects, ...nearSuspects].map((s) => s.id)).size} distinct cards. Open each capture and ` +
      `compare it to the label before changing anything — this list nominates, it does not decide.`,
  );
}

main();
