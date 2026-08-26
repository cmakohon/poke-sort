// Replays fusion and gating variants against eval/signals.json.
//
//   pnpm eval:tune
//
// No database, no model, no OCR — everything expensive was captured once by
// eval/capture-signals.ts, so the main sweep is fast. That speed is what makes
// tuning honest: every candidate is measured, and the measurement procedure
// itself is cross-validated.
//
// Cost warning, because the grid multiplies and the report order hides it:
// every weight added to IdentityProfile multiplies allConfigs() by its option
// count, and the split-half CV at the bottom re-runs the WHOLE grid 40 times.
// At 26k configs over 956 captures that section runs for the better part of an
// hour while everything above it prints in minutes. The per-config gates —
// full-set FALSE, the cliff neighbourhood, the fixed-config held-out figure —
// all land before it, so reading those and stopping is a reasonable thing to
// do; the CV validates the SELECTION PROCEDURE, not the config you ship.
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
  ALL_SIGNALS,
  collectorNumberMatch,
  nameSimilarity,
  setAbbreviationMatch,
  setTotalMatch,
  type RerankInput,
} from "../src/lib/identify/rerank";
import {
  POKEMON_PROFILE,
  type IdentityProfile,
} from "../src/lib/identify/profiles";

import { SIGNALS_PATH } from "./eval-set";

interface Capture {
  expectedId: string;
  setCode: string;
  ocr: OcrReading;
  candidates: RerankInput[];
}

// Derived, not restated: adding a signal to the profile must break this file
// rather than silently tune a different objective than the one that ships.
type Weights = IdentityProfile["weights"];

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
// The same list production fuses over, imported rather than copied.
const KEYS = ALL_SIGNALS;
const CUTOFF = POKEMON_PROFILE.distanceCutoff;

/**
 * Per-candidate signals that do not depend on the fusion weights.
 *
 * `artWeight` is the exception: it changes the embedding signal itself, so it
 * cannot be swept inside `run` like the others. main() re-prepares per art
 * weight and sweeps the rest inside that.
 */
interface Prepared {
  expectedId: string;
  era: string;
  sigs: Signals[];
  ids: string[];
  distances: number[];
  informativeMask: boolean[]; // aligned with KEYS
  /** distance-sorted: nearest id and the gap to the next id. */
  nearestId: string;
  nearestD: number;
  gapToSecond: number;
  /** How many candidates actually carried an art vector. */
  artCoverage: number;
  /**
   * How many candidates' embedding signal clamped to exactly 0.
   *
   * A blended distance can exceed distanceCutoff where the raw one did not, and
   * candidates pinned at 0 tie on score and fall through to the raw-distance
   * tiebreak — which changes what `margin` means. If this jumps with art
   * weight, the ramp needs looking at, not just the gate.
   */
  pinnedEmbedding: number;
}

function prepare(cap: Capture, artWeight: number): Prepared {
  // Mirrors scoreCandidate: the two views fuse into one distance before the
  // ramp, and a candidate with no art vector keeps its whole-card distance.
  const blended = (c: RerankInput) =>
    c.artDistance == null
      ? c.distance
      : (1 - artWeight) * c.distance + artWeight * c.artDistance;
  const sigs = cap.candidates.map((c) => ({
    embedding: Math.max(0, Math.min(1, 1 - blended(c) / CUTOFF)),
    name: nameSimilarity(cap.ocr.name, c.name),
    collectorNumber: collectorNumberMatch(cap.ocr, c),
    setAbbreviation: setAbbreviationMatch(cap.ocr, c),
    setTotal: setTotalMatch(cap.ocr, c),
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
    // setCode has been carried through this harness since it was written and
    // never read. It matters: pl is ~440 of the 956 real captures and hgss is
    // ~97, so pickBest maximising aggregate accepts will trade ten hgss points
    // for two pl points and call it an improvement. Per-era is the only way to
    // see that happening.
    era: cap.setCode.replace(/[\d.]+$/, "") || cap.setCode,
    sigs,
    ids: cap.candidates.map((c) => c.id),
    distances: cap.candidates.map((c) => c.distance),
    artCoverage: cap.candidates.filter((c) => c.artDistance != null).length,
    pinnedEmbedding: sigs.filter((s) => s.embedding === 0).length,
    informativeMask,
    // RAW distance, not blended: these feed the distanceGap valve, which
    // production also runs on raw distance so distanceCutoff stays calibrated.
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
  byEra: Record<string, EraCounts>;
  /** truth -> what was accepted instead. A count alone cannot be argued with. */
  falseAcceptPairs: string[];
}

interface EraCounts {
  n: number;
  top1: number;
  accepted: number;
  falseAccepts: number;
  review: number;
}

function run(preps: Prepared[], cfg: Config): Report {
  const r: Report = {
    n: preps.length, top1: 0, accepted: 0, falseAccepts: 0, falseAcceptPairs: [],
    review: 0, reviewCorrect: 0, noMatch: 0, byRule: {}, byEra: {},
  };
  const era = (p: Prepared): EraCounts =>
    (r.byEra[p.era] ??= { n: 0, top1: 0, accepted: 0, falseAccepts: 0, review: 0 });
  for (const p of preps) {
    era(p).n++;
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
    if (correct) {
      r.top1++;
      era(p).top1++;
    }
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
      // Mirrors decideTier: the valve relaxes the margin, not minScore.
      bestScore >= cfg.gate.minScore &&
      p.ids[bestI] === p.nearestId &&
      p.nearestD <= cfg.gate.distanceGap.d1Max &&
      p.gapToSecond >= cfg.gate.distanceGap.gapMin
    ) {
      released = "distance-gap";
    }

    if (released) {
      r.accepted++;
      era(p).accepted++;
      if (!correct) {
        r.falseAccepts++;
        era(p).falseAccepts++;
        r.falseAcceptPairs.push(`${p.expectedId}->${p.ids[bestI]}`);
      }
      r.byRule[released] = (r.byRule[released] ?? 0) + 1;
    } else {
      r.review++;
      era(p).review++;
      if (correct) r.reviewCorrect++;
    }
  }
  return r;
}

/**
 * The shipped gate has to be IN the grid, or "full-set best" is not a
 * comparison — it is a different question.
 *
 * It was not: minMargin 0.05 and distanceGap {0.15, 0.02} are what
 * profiles.ts ships and neither was reachable, so pickBest returned a config
 * scoring 4.8 points of accept rate BELOW the live profile and called it best.
 * Anything picked on that basis silently changes the gate as well as the thing
 * under test.
 */
function* allConfigs(): Generator<Config> {
  for (const e of [0.3, 0.4, 0.5]) {
    for (const nm of [0.1, 0.15, 0.2]) {
      for (const cn of [0.2, 0.25, 0.3]) {
        for (const sa of [0.05, 0.1]) {
         // 0 is in the grid on purpose: it is the revert. If the denominator
         // signal does not pay, pickBest turns it off by itself rather than
         // anyone having to argue for removing it.
         for (const st of [0, 0.02, 0.03, 0.05]) {
          const w: Weights = { embedding: e, name: nm, collectorNumber: cn, setAbbreviation: sa, setTotal: st, hp: 0.05 };
          for (const minMargin of [0.02, 0.03, 0.04, 0.05, 0.06, 0.08]) {
            for (const minScore of [0.4, 0.45, 0.5, 0.55, 0.6]) {
              for (const dg of [
                null,
                { d1Max: 0.08, gapMin: 0.03 },
                { d1Max: 0.1, gapMin: 0.04 },
                { d1Max: 0.15, gapMin: 0.02 },
              ]) {
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

/**
 * Per-era breakdown, biggest era first, with a baseline to diff against.
 *
 * The aggregate hides the trade this whole harness is prone to making: a
 * config that buys accepts on the era with the most captures while losing
 * top-1 on a small one scores better on `accepted` and is worse in the bin.
 * The rule is that no era's top-1 may drop and no era may gain a false accept,
 * which needs both numbers side by side to check.
 */
function showEras(r: Report, base?: Report): void {
  const rows = Object.entries(r.byEra).sort((a, b) => b[1].n - a[1].n);
  const delta = (now: number, was: number | undefined) =>
    was == null || was === now ? "" : ` (${now > was ? "+" : ""}${now - was})`;
  console.log(
    "  " + "era".padEnd(7) + "n".padStart(5) + "top1".padStart(8) +
      "".padStart(7) + "accept".padStart(8) + "".padStart(7) +
      "review".padStart(8) + "FALSE".padStart(8),
  );
  for (const [era, c] of rows) {
    if (c.n === 0) continue;
    const b = base?.byEra[era];
    console.log(
      "  " + era.padEnd(7) + String(c.n).padStart(5) +
        pct(c.top1, c.n).padStart(8) + delta(c.top1, b?.top1).padEnd(7) +
        pct(c.accepted, c.n).padStart(8) + delta(c.accepted, b?.accepted).padEnd(7) +
        pct(c.review, c.n).padStart(8) +
        `${c.falseAccepts}${delta(c.falseAccepts, b?.falseAccepts)}`.padStart(8),
    );
  }
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
  const baseCfg: Config = {
    w: POKEMON_PROFILE.weights,
    gate: {
      minScore: POKEMON_PROFILE.accept.minScore,
      minMargin: POKEMON_PROFILE.accept.minMargin,
      reviewFloor: POKEMON_PROFILE.reviewFloor,
      distanceGap: POKEMON_PROFILE.accept.distanceGap ?? null,
    },
  };

  // Art weight first, and against the SHIPPED gate rather than inside the
  // grid. It changes the embedding signal, so sweeping it with everything else
  // would mean re-preparing every capture per grid point — the grid is already
  // 25,920 configs and an hour of CV. Pick it here, then tune the rest at the
  // chosen value.
  const artSweep = [0, 0.15, 0.25, 0.35, 0.5];
  const coverage = captures.length
    ? prepare(captures[0], 0).artCoverage / (captures[0].candidates.length || 1)
    : 0;
  console.log(
    `\n${captures.length} captures, art vector coverage ${(coverage * 100).toFixed(0)}% ` +
      "of the first capture's candidates",
  );
  if (coverage === 0) {
    console.log(
      "  NOTE: no art distances in this dump — every art weight will read the " +
        "same. Rebuild it with eval:capture against a catalog that has them.",
    );
  }
  console.log("\nart weight sweep (shipped gate):");
  let artBaseline: Report | undefined;
  for (const aw of artSweep) {
    const p = captures.map((c) => prepare(c, aw));
    const r = run(p, baseCfg);
    const pinned = p.reduce((sum, x) => sum + x.pinnedEmbedding, 0);
    const cands = p.reduce((sum, x) => sum + x.sigs.length, 0);
    console.log(
      `  aw ${String(aw).padEnd(5)} top1 ${((r.top1 / r.n) * 100).toFixed(1)}%  ` +
        `accept ${((r.accepted / r.n) * 100).toFixed(1)}%  false ${r.falseAccepts}  ` +
        `embedding-pinned-at-0 ${((pinned / cands) * 100).toFixed(1)}%` +
        (r.falseAcceptPairs.length
          ? `\n         false: ${r.falseAcceptPairs.join(", ")}`
          : ""),
    );
    showEras(r, artBaseline);
    artBaseline ??= r;
  }

  // Everything below runs at one art weight: the profile's, unless overridden.
  const artWeight = Number(process.env.ART_WEIGHT ?? POKEMON_PROFILE.artWeight);
  console.log(`\ntuning the rest at art weight ${artWeight}\n`);
  const preps = captures.map((c) => prepare(c, artWeight));
  const baseReport = run(preps, baseCfg);
  show("current profile", baseReport);
  showEras(baseReport);

  const best = pickBest(preps);
  if (!best) {
    console.log("no zero-false configuration found");
    return;
  }
  console.log("");
  show(`full-set best ${JSON.stringify(best.cfg)}`, best.r);
  showEras(best.r, baseReport);

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
    // The grid argmax itself, so it gets the same no-re-picking held-out
    // estimate as the hand-written entries rather than only a full-set figure.
    ["grid best", best.cfg],
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
