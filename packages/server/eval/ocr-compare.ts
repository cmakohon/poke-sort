// Compares two ocr-sweep configs as PAIRED data.
//
//   pnpm exec tsx eval/ocr-compare.ts production all-normalise
//   pnpm exec tsx eval/ocr-compare.ts production all-normalise hgss
//
// Marginals cannot settle a band or preprocessing change. "7 of 97 versus 17
// of 97" is anywhere from p=0.002 (the 7 are a subset of the 17) to p=0.064
// (they are disjoint), and the two readings differ on whether the change is
// worth shipping. Only the overlap decides, so ocr-sweep writes one row per
// probe and this reads them back.
//
// Two aggregations, and the card-level one is the honest one: repeat scans of
// the same physical card in the same session share lighting and framing, so
// they are not independent samples. A change that rescues one card scanned
// nine times looks like nine wins at probe level and is one.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVAL_SET } from "./eval-set";

const here = path.dirname(fileURLToPath(import.meta.url));
const DUMP_DIR = path.join(here, ".sweep");

interface Row {
  file: string;
  id: string;
  era: string;
  right: boolean;
  wrongFull: boolean;
}

/**
 * Two-sided exact McNemar. With b and c discordant pairs the null is a fair
 * coin over b+c trials, so the exact binomial beats the chi-square
 * approximation at the counts this harness produces (b+c is routinely < 25).
 */
function mcnemar(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const lo = Math.min(b, c);
  let logC = 0; // log C(n, k), updated incrementally to survive large n
  let tail = 0;
  for (let k = 0; k <= lo; k++) {
    if (k > 0) logC += Math.log((n - k + 1) / k);
    tail += Math.exp(logC + n * Math.log(0.5));
  }
  return Math.min(1, 2 * tail);
}

async function load(label: string): Promise<Row[]> {
  const file = path.join(DUMP_DIR, `${EVAL_SET}-${label}.jsonl`);
  const text = await readFile(file, "utf-8").catch(() => {
    throw new Error(`no dump for "${label}" — run eval/ocr-sweep.ts first (${file})`);
  });
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row);
}

function report(
  title: string,
  pairs: { a: boolean; b: boolean }[],
): void {
  const b = pairs.filter((p) => p.a && !p.b).length; // A wins
  const c = pairs.filter((p) => !p.a && p.b).length; // B wins
  const p = mcnemar(b, c);
  const share = b + c === 0 ? 0 : Math.max(b, c) / (b + c);
  console.log(
    `  ${title.padEnd(22)} n=${String(pairs.length).padStart(4)}  ` +
      `A-only=${String(b).padStart(3)}  B-only=${String(c).padStart(3)}  ` +
      `p=${p < 0.001 ? "<0.001" : p.toFixed(3)}  ` +
      `share=${(share * 100).toFixed(0)}%`,
  );
}

async function main() {
  const [labelA, labelB, eraFilter] = process.argv.slice(2);
  if (!labelA || !labelB) {
    throw new Error("usage: ocr-compare.ts <configA> <configB> [era]");
  }
  const [rowsA, rowsB] = await Promise.all([load(labelA), load(labelB)]);

  const byFileB = new Map(rowsB.map((r) => [r.file, r]));
  const paired = rowsA
    .map((a) => ({ a, b: byFileB.get(a.file) }))
    .filter((x): x is { a: Row; b: Row } => x.b != null)
    .filter((x) => !eraFilter || x.a.era === eraFilter);

  if (paired.length === 0) throw new Error("no probes in common");
  // Dumps from different sweep runs join silently on `file`, so a 40-probe
  // smoke test compared against a 1068-probe grid would quietly report on 40
  // and look like a real result. Say so rather than let it pass.
  if (rowsA.length !== rowsB.length) {
    console.log(
      `WARNING: ${labelA} has ${rowsA.length} probes and ${labelB} has ${rowsB.length} — ` +
        `these are from different sweep runs. Re-run both before trusting this.`,
    );
  }

  console.log(
    `A=${labelA}  B=${labelB}${eraFilter ? `  era=${eraFilter}` : ""}  (${paired.length} paired probes)`,
  );
  console.log(
    `  A RIGHT=${paired.filter((x) => x.a.right).length}  ` +
      `B RIGHT=${paired.filter((x) => x.b.right).length}  ` +
      `A WRONG_FULL=${paired.filter((x) => x.a.wrongFull).length}  ` +
      `B WRONG_FULL=${paired.filter((x) => x.b.wrongFull).length}`,
  );
  console.log("\nRIGHT — did the true card's number get read?");
  report("per probe", paired.map((x) => ({ a: x.a.right, b: x.b.right })));

  // Card level: a card counts for whichever config read it right more often.
  const byCard = new Map<string, { a: number; b: number; n: number }>();
  for (const x of paired) {
    const e = byCard.get(x.a.id) ?? { a: 0, b: 0, n: 0 };
    e.n++;
    if (x.a.right) e.a++;
    if (x.b.right) e.b++;
    byCard.set(x.a.id, e);
  }
  report(
    "per distinct card",
    [...byCard.values()].map((e) => ({ a: e.a > e.b, b: e.b > e.a })),
  );

  console.log("\nWRONG_FULL — did a read land on the wrong candidate? (lower is better)");
  report("per probe", paired.map((x) => ({ a: x.a.wrongFull, b: x.b.wrongFull })));

  // The cards that actually moved. seam-right died because two of them could
  // be named; naming them should not require archaeology.
  const gained = paired.filter((x) => !x.a.right && x.b.right);
  const lost = paired.filter((x) => x.a.right && !x.b.right);
  const newWrong = paired.filter((x) => !x.a.wrongFull && x.b.wrongFull);
  const show = (title: string, rows: { a: Row }[]) => {
    if (rows.length === 0) return;
    console.log(`\n${title} (${rows.length}):`);
    for (const r of rows) console.log(`  ${r.a.id.padEnd(14)} ${r.a.era}  ${r.a.file}`);
  };
  show(`B reads, A does not`, gained);
  show(`A reads, B does not`, lost);
  show(`NEW WRONG_FULL under B — inspect every one`, newWrong);
}

main();
