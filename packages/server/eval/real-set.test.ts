// Replays the labelled real-capture signals through the PRODUCTION reranker
// and asserts the floors that matter, per era.
//
//   pnpm --filter @poke-sort/server test
//
// No database, no model, no OCR — it reads one JSON file and runs `rerank` and
// `decideTier` exactly as the scanner does, so it is fast enough to live in
// the normal test run rather than behind an eval script.
//
// Why this exists: the seam-right band (5526f2e) shipped, cost two false
// accepts on the real set, and was only caught because someone went looking.
// Nothing in the repo would have failed. `accuracy.test.ts` guards the
// synthetic renders and refuses to run against the real set at all, and the
// eval scripts are all manual. This is the guard that turns "we noticed" into
// "the build failed".
//
// The floors are REGRESSION guards, not targets — each sits below the measured
// value with room for the set to grow, because build-real-fixtures adds
// captures every time someone works the review queue. Tightening them to the
// current number would make every rebuild a red build, and that is not
// theoretical: the first version of this file floored accept at 0.85 against a
// 956-capture dump, and the very next rebuild (1068 captures, hgss 58 -> 97)
// measured 81.8% and failed. Newer captures skew harder because the review
// queue is worked newest-first.
//
// Measured on the 1068-capture dump of 2026-08-25, at artWeight 0.25 with the
// gate re-tuned for it: overall top1 97.2%, accept 85.0%; pl 99.4%, dp 96.7%,
// bw 99.4%, hgss 89.7%, me 100%, xy 96.4%, base 89.5%. Update these when you
// move a floor, so the next person can see drift rather than guess at it.
//
// The same dump before the art blend: top1 95.6%, accept 81.8%; pl 98.6%,
// dp 98.6%, bw 98.8%, hgss 74.2%.
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { OcrReading } from "@poke-sort/shared";
import { POKEMON_PROFILE } from "../src/lib/identify/profiles";
import { decideTier, rerank, type RerankInput } from "../src/lib/identify/rerank";

interface Capture {
  expectedId: string;
  setCode: string;
  ocr: OcrReading;
  candidates: RerankInput[];
}

// Deliberately not eval-set.ts's SIGNALS_PATH: this suite is about the real
// captures specifically, and reading EVAL_FIXTURES here would let a stray env
// var silently point it at the renders and pass for the wrong reason.
//
// Two sources, in order. The raw dump is what eval:capture writes and is
// gitignored at ~9.7MB; the gzipped snapshot is committed (~1.4MB) so CI has
// something to check against. Local runs prefer the raw file because it is the
// one that just got regenerated — a snapshot someone forgot to refresh should
// not quietly outrank it.
const RAW = new URL("./signals-pokemon-real.json", import.meta.url);
const SNAPSHOT = new URL("./signals-pokemon-real.json.gz", import.meta.url);

function loadSignals(): string | null {
  if (existsSync(RAW)) return readFileSync(RAW, "utf-8");
  if (existsSync(SNAPSHOT)) return gunzipSync(readFileSync(SNAPSHOT)).toString("utf-8");
  return null;
}

const raw = loadSignals();
const present = raw != null;

interface Counts {
  n: number;
  top1: number;
  accepted: number;
  falseAccepts: number;
}

describe.skipIf(!present)("real-capture set (production rerank)", () => {
  const { captures } = JSON.parse(raw!) as { captures: Capture[] };

  const overall: Counts = { n: 0, top1: 0, accepted: 0, falseAccepts: 0 };
  const byEra = new Map<string, Counts>();
  const falseAcceptIds: string[] = [];

  for (const cap of captures) {
    const era = cap.setCode.replace(/[\d.]+$/, "") || cap.setCode;
    const e = byEra.get(era) ?? { n: 0, top1: 0, accepted: 0, falseAccepts: 0 };
    e.n++;
    overall.n++;

    const ranked = rerank(cap.candidates, cap.ocr, POKEMON_PROFILE);
    const { tier } = decideTier(ranked, POKEMON_PROFILE);
    const correct = ranked[0]?.id === cap.expectedId;
    if (correct) {
      overall.top1++;
      e.top1++;
    }
    if (tier === "accept") {
      overall.accepted++;
      e.accepted++;
      if (!correct) {
        overall.falseAccepts++;
        e.falseAccepts++;
        falseAcceptIds.push(`${cap.expectedId} -> ${ranked[0]?.id}`);
      }
    }
    byEra.set(era, e);
  }

  it("accepts nothing wrongly", () => {
    // Named, not counted: a false accept is one identifiable card, and the
    // first question anyone asks is which.
    expect(falseAcceptIds).toEqual([]);
  });

  it("holds its overall floors", () => {
    expect(overall.n).toBeGreaterThan(500);
    expect(overall.top1 / overall.n).toBeGreaterThan(0.955);
    expect(overall.accepted / overall.n).toBeGreaterThan(0.82);
  });

  // Without this, a snapshot captured before the catalog had art vectors makes
  // every assertion above pass by measuring artWeight-0 behaviour while
  // production runs blended — green for the wrong reason, and invisible,
  // because loadSignals prefers the raw dump locally and the committed
  // snapshot in CI, so the two can disagree silently.
  it("replays a dump that actually carries art distances", () => {
    if (POKEMON_PROFILE.artWeight === 0) return;
    const total = captures.reduce((sum, c) => sum + c.candidates.length, 0);
    const withArt = captures.reduce(
      (sum, c) => sum + c.candidates.filter((k) => k.artDistance != null).length,
      0,
    );
    expect(withArt / total).toBeGreaterThan(0.9);
  });

  // Per era, because the aggregate hides the trade this pipeline is prone to:
  // pl is roughly half the set, so a change that buys pl accepts while losing
  // a small era's top-1 improves every global number and is worse in the bin.
  // Only eras with enough captures to mean anything are asserted.
  const FLOORS: Record<string, number> = {
    pl: 0.97,
    // Lowered from 0.97 when the art blend shipped, and it is the one place
    // that change cost something: dp measures 96.7%, down from 98.6%. Four
    // captures — dp2-113 twice, dp7-84, dp1-103 — against 26 gained elsewhere.
    // The loss is intrinsic to the blend rather than the gate (top-1 does not
    // depend on the gate at all), and the alternative that spares dp, giving
    // its series no art window, measured far worse everywhere. Deliberate, and
    // the ledger is in docs/hgss-identification-accuracy.md.
    dp: 0.95,
    bw: 0.97,
    // Was 0.68 when hgss was the problem this branch existed to fix; it
    // measures 89.7% now. At n=97 a three-point move is three cards, so the
    // floor still sits low enough to ignore that noise and only catch a
    // genuine collapse — but high enough that losing the art blend fails here.
    hgss: 0.84,
  };

  it.each(Object.entries(FLOORS))("keeps %s top-1 above %d", (era, floor) => {
    const c = byEra.get(era);
    if (!c || c.n < 30) return; // too few to assert on; not a failure
    expect(c.top1 / c.n).toBeGreaterThan(floor);
  });
});
