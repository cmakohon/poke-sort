// Replays fusion and gating variants against eval/signals.json.
//
//   pnpm eval:tune
//
// No database, no model, no OCR — everything expensive was captured once by
// eval/capture-signals.ts, so a full sweep of ~10k configurations runs in
// seconds. That speed is what makes tuning honest: every candidate is
// measured, and the measurement procedure itself is cross-validated.
//
// The objective is fixed and asymmetric: ZERO false accepts on the fixtures,
// then the highest accept rate available under that constraint. A wrongly
// sorted card is worse than a reviewed one, so false-accept is a constraint
// rather than a term some weight could trade away.
//
// Two guards against overfitting 150 fixtures:
//  - Split-half cross-validation of the SELECTION PROCEDURE: tune on a random
//    half, evaluate the winner on the other half, 40 times. If held-out halves
//    show false accepts, the procedure is optimistic and the config is not
//    trusted.
//  - A cliff report around the chosen config: how far the thresholds sit from
//    the first configuration that admits a false accept.
import { readFile } from "node:fs/promises";
import type { OcrReading } from "@poke-sort/shared";
import {
  collectorNumberMatch,
  nameSimilarity,
  setAbbreviationMatch,
  type RerankInput,
} from "../src/lib/identify/rerank";
import { POKEMON_PROFILE } from "../src/lib/identify/profiles";

import { SIGNALS_PATH } from "./eval-set";

interface Capture {
  expectedId: string;
  setCode: string;
  ocr: OcrReading;
  candidates: RerankInput[];
}

interface Weights {
  embedding: number;
  name: number;
  collectorNumber: number;
  setAbbreviation: number;
  hp: number;
}

interface Gate {
  minScore: number;
  minMargin: number;
  reviewFloor: number;
  /** Accept when the image alone is unambiguous: d1 under d1Max AND the gap to
   *  the nearest DIFFERENT card at least gapMin. */
  distanceGap: { d1Max: number; gapMin: number } | null;
}

interface Config {
  w: Weights;
  gate: Gate;
}

type Signals = Record<keyof Weights, number>;
const KEYS = ["embedding", "name", "collectorNumber", "setAbbreviation", "hp"] as const;
const CUTOFF = POKEMON_PROFILE.distanceCutoff;

/** Weight-independent per-candidate signals, computed once. */
interface Prepared {
  expectedId: string;
  sigs: Signals[];
  ids: string[];
  distances: number[];
  informativeMask: boolean[]; // aligned with KEYS
  /** distance-sorted: nearest id and the gap to the next id. */
  nearestId: string;
  nearestD: number;
  gapToSecond: number;
}

function prepare(cap: Capture): Prepared {
  const sigs = cap.candidates.map((c) => ({
    embedding: Math.max(0, Math.min(1, 1 - c.distance / CUTOFF)),
    name: nameSimilarity(cap.ocr.name, c.name),
    collectorNumber: collectorNumberMatch(cap.ocr, c),
    setAbbreviation: setAbbreviationMatch(cap.ocr, c),
    hp: cap.ocr.hp != null && c.hp != null && cap.ocr.hp === c.hp ? 1 : 0,
  }));
  const informativeMask = KEYS.map(
    (k) => k === "embedding" || sigs.some((s) => s[k] > 0),
  );
  const byD = cap.candidates
    .map((c) => ({ id: c.id, d: c.distance }))
    .sort((a, b) => a.d - b.d);
  return {
    expectedId: cap.expectedId,
    sigs,
    ids: cap.candidates.map((c) => c.id),
    distances: cap.candidates.map((c) => c.distance),
    informativeMask,
    nearestId: byD[0]?.id ?? "",
    nearestD: byD[0]?.d ?? Infinity,
    gapToSecond: byD.length > 1 ? byD[1].d - byD[0].d : Infinity,
  };
}

function fuse(s: Signals, w: Weights, mask: boolean[]): number {
  let m = 0;
  let t = 0;
  for (let i = 0; i < KEYS.length; i++) {
    if (!mask[i]) continue;
    const k = KEYS[i];
    m += w[k];
    t += w[k] * s[k];
  }
  return m > 0 ? t / m : 0;
}

interface Report {
  n: number;
  top1: number;
  accepted: number;
  falseAccepts: number;
  review: number;
  reviewCorrect: number;
  noMatch: number;
  byRule: Record<string, number>;
}

function run(preps: Prepared[], cfg: Config): Report {
  const r: Report = {
    n: preps.length, top1: 0, accepted: 0, falseAccepts: 0,
    review: 0, reviewCorrect: 0, noMatch: 0, byRule: {},
  };
  for (const p of preps) {
    if (p.ids.length === 0) {
      r.noMatch++;
      continue;
    }
    let bestI = 0;
    let bestScore = -1;
    let secondScore = -1;
    for (let i = 0; i < p.ids.length; i++) {
      const s = fuse(p.sigs[i], cfg.w, p.informativeMask);
      if (s > bestScore || (s === bestScore && p.distances[i] < p.distances[bestI])) {
        secondScore = bestScore;
        bestScore = s;
        bestI = i;
      } else if (s > secondScore) {
        secondScore = s;
      }
    }
    const correct = p.ids[bestI] === p.expectedId;
    if (correct) r.top1++;
    const margin = secondScore >= 0 ? bestScore - secondScore : null;

    if (bestScore < cfg.gate.reviewFloor) {
      r.noMatch++;
      continue;
    }
    let released: string | null = null;
    if (bestScore >= cfg.gate.minScore && (margin == null || margin >= cfg.gate.minMargin)) {
      released = "score+margin";
    } else if (
      cfg.gate.distanceGap &&
      p.ids[bestI] === p.nearestId &&
      p.nearestD <= cfg.gate.distanceGap.d1Max &&
      p.gapToSecond >= cfg.gate.distanceGap.gapMin
    ) {
      released = "distance-gap";
    }

    if (released) {
      r.accepted++;
      if (!correct) r.falseAccepts++;
      r.byRule[released] = (r.byRule[released] ?? 0) + 1;
    } else {
      r.review++;
      if (correct) r.reviewCorrect++;
    }
  }
  return r;
}

function* allConfigs(): Generator<Config> {
  for (const e of [0.3, 0.4, 0.5]) {
    for (const nm of [0.1, 0.15, 0.2]) {
      for (const cn of [0.2, 0.25, 0.3]) {
        for (const sa of [0.05, 0.1]) {
          const w: Weights = { embedding: e, name: nm, collectorNumber: cn, setAbbreviation: sa, hp: 0.05 };
          for (const minMargin of [0.02, 0.03, 0.04, 0.06, 0.08]) {
            for (const minScore of [0.4, 0.45, 0.5, 0.55, 0.6]) {
              for (const dg of [null, { d1Max: 0.08, gapMin: 0.03 }, { d1Max: 0.1, gapMin: 0.04 }]) {
                yield {
                  w,
                  gate: { minScore, minMargin, reviewFloor: 0.3, distanceGap: dg },
                };
              }
            }
          }
        }
      }
    }
  }
}

function pickBest(preps: Prepared[]): { cfg: Config; r: Report } | null {
  let best: { cfg: Config; r: Report } | null = null;
  for (const cfg of allConfigs()) {
    const r = run(preps, cfg);
    if (r.falseAccepts > 0) continue;
    if (
      !best ||
      r.accepted > best.r.accepted ||
      (r.accepted === best.r.accepted && r.top1 > best.r.top1)
    ) {
      best = { cfg, r };
    }
  }
  return best;
}

const pct = (v: number, n: number) => `${((v / n) * 100).toFixed(1)}%`;
function show(label: string, r: Report): void {
  console.log(
    `${label.padEnd(40)} top1=${pct(r.top1, r.n)}  accept=${pct(r.accepted, r.n)}` +
      `  FALSE=${r.falseAccepts}  review=${pct(r.review, r.n)}` +
      ` (correct held: ${r.reviewCorrect})  ${JSON.stringify(r.byRule)}`,
  );
}

/** Deterministic PRNG so CV splits are reproducible. */
function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const { captures } = JSON.parse(
    await readFile(SIGNALS_PATH, "utf-8"),
  ) as { captures: Capture[] };
  const preps = captures.map(prepare);
  console.log(`\n${preps.length} captures\n`);

  const baseCfg: Config = {
    w: POKEMON_PROFILE.weights,
    gate: {
      minScore: POKEMON_PROFILE.accept.minScore,
      minMargin: POKEMON_PROFILE.accept.minMargin,
      reviewFloor: POKEMON_PROFILE.reviewFloor,
      distanceGap: POKEMON_PROFILE.accept.distanceGap ?? null,
    },
  };
  show("current profile", run(preps, baseCfg));

  const best = pickBest(preps);
  if (!best) {
    console.log("no zero-false configuration found");
    return;
  }
  console.log("");
  show(`full-set best ${JSON.stringify(best.cfg)}`, best.r);

  // Cliff report: nudge each threshold one notch looser and report the damage,
  // so the distance between the chosen config and trouble is visible.
  console.log("\ncliff neighbourhood:");
  const nudges: [string, Config][] = [
    ["margin -0.01", { ...best.cfg, gate: { ...best.cfg.gate, minMargin: best.cfg.gate.minMargin - 0.01 } }],
    ["score -0.05", { ...best.cfg, gate: { ...best.cfg.gate, minScore: best.cfg.gate.minScore - 0.05 } }],
    ...(best.cfg.gate.distanceGap
      ? ([["gap wider", { ...best.cfg, gate: { ...best.cfg.gate, distanceGap: { d1Max: best.cfg.gate.distanceGap.d1Max + 0.02, gapMin: best.cfg.gate.distanceGap.gapMin - 0.01 } } }]] as [string, Config][])
      : []),
  ];
  for (const [label, cfg] of nudges) show(`  ${label}`, run(preps, cfg));

  // Conservative shortlist: the argmax sits one notch from the false-accept
  // cliff, so what does stepping back cost? Each is also given its own
  // fixed-config held-out estimate (no re-picking, so no selection optimism).
  console.log("\nconservative shortlist:");
  const wBest = best.cfg.w;
  const shortlist: [string, Config][] = [
    ["margin .04 score .45", { w: wBest, gate: { minScore: 0.45, minMargin: 0.04, reviewFloor: 0.3, distanceGap: null } }],
    ["margin .05 score .5", { w: wBest, gate: { minScore: 0.5, minMargin: 0.05, reviewFloor: 0.3, distanceGap: null } }],
    ["margin .05 score .5 +dgap", { w: wBest, gate: { minScore: 0.5, minMargin: 0.05, reviewFloor: 0.3, distanceGap: { d1Max: 0.1, gapMin: 0.04 } } }],
    ["margin .06 score .5 +dgap", { w: wBest, gate: { minScore: 0.5, minMargin: 0.06, reviewFloor: 0.3, distanceGap: { d1Max: 0.1, gapMin: 0.04 } } }],
  ];
  for (const [label, cfg] of shortlist) {
    show(`  ${label}`, run(preps, cfg));
    // fixed-config split estimate
    const rand2 = mulberry(7);
    let fa = 0; let n2 = 0;
    for (let k = 0; k < 40; k++) {
      const sh = [...preps].sort(() => rand2() - 0.5);
      const b2 = sh.slice(Math.floor(sh.length / 2));
      const rb = run(b2, cfg);
      fa += rb.falseAccepts; n2 += rb.n;
    }
    console.log(`    fixed-config held-out false: ${fa}/${n2}`);
  }

  // Cross-validation of the selection procedure.
  console.log("\nsplit-half CV (tune on A, evaluate on B), 40 splits:");
  const rand = mulberry(42);
  let heldFalse = 0;
  let heldN = 0;
  const heldAccept: number[] = [];
  for (let k = 0; k < 40; k++) {
    const shuffled = [...preps].sort(() => rand() - 0.5);
    const half = Math.floor(shuffled.length / 2);
    const a = shuffled.slice(0, half);
    const b = shuffled.slice(half);
    const picked = pickBest(a);
    if (!picked) continue;
    const rb = run(b, picked.cfg);
    heldFalse += rb.falseAccepts;
    heldN += rb.n;
    heldAccept.push(rb.accepted / rb.n);
  }
  heldAccept.sort((x, y) => x - y);
  console.log(
    `  held-out false accepts: ${heldFalse}/${heldN} (${pct(heldFalse, heldN)})` +
      `  held-out accept rate: median ${pct(heldAccept[Math.floor(heldAccept.length / 2)] * 100, 100)}` +
      ` range ${pct(heldAccept[0] * 100, 100)}..${pct(heldAccept[heldAccept.length - 1] * 100, 100)}`,
  );
}

main();
