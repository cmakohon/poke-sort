// Measures collector-number OCR for band/preprocessing variants.
//
//   pnpm exec tsx eval/ocr-sweep.ts
//   EVAL_FIXTURES=pokemon-real EVAL_SAMPLE=200 pnpm exec tsx eval/ocr-sweep.ts
//
// This sweep NOMINATES; eval:tune decides. Nothing ships on a number from
// here. That is not modesty, it is the lesson of the seam-right band (5526f2e):
// it won the old sweep 175 hits to 159 and cost two false accepts on 956
// probes, because a hit count cannot see a read that is confidently wrong.
// Hence WRONG_FULL below, and hence the rule that benefit may be sampled but
// harm may not — a variant's WRONG_FULL is only meaningful on the full set.
//
// Two things this file used to get wrong, both fixed by reading the production
// code rather than a copy of it (`readCollectorNumber`):
//
//   - It chose bands under 3x-normalise while production read them under
//     4x-contrast-sharpen, so pass 1 ranked bands for a pipeline that does not
//     run.
//   - It had no escalation pass at all, so it understated every band the
//     ladder rescues and could not measure the ladder itself.
//
// The old greedy bands -> prep -> psm structure is gone too. It assumed the
// dimensions were independent and they are not: escalation only fires when no
// band parsed a full fraction, so a preprocessing change that reads more
// numbers fires escalation LESS. Picking a band under one prep and then a prep
// under that band walks straight past the interaction. Configs are enumerated
// explicitly instead — say what you want compared, and compare it.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  disposeOcr,
  readCollectorNumber,
  productionCollectorPlan,
  ESCALATION,
  type CollectorNumberPlan,
  type ReadOptions,
} from "../src/lib/identify/ocr";
import { collectorNumberMatch, type RerankInput } from "../src/lib/identify/rerank";
import { POKEMON_PROFILE, type OcrRegion } from "../src/lib/identify/profiles";
import sharp from "sharp";
import { EVAL_SET, FIXTURES_DIR, SIGNALS_PATH } from "./eval-set";

const FIXTURES = FIXTURES_DIR;
const DUMP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), ".sweep");
const OCR = POKEMON_PROFILE.ocr!;

// ---------------------------------------------------------------- variants

/** What production reads collector bands under today. */
const CONTRAST: ReadOptions = { contrast: true };
/** Plain normalise — what the bands were originally chosen under. */
const NORMALISE: ReadOptions = {};
const NORMALISE_SHARPEN: ReadOptions = { sharpen: true };

/** Deep right, y .945-.995: dp, base, later-ex, neo. Production's band 0. */
const DEEP_RIGHT: OcrRegion = OCR.collectorNumber[0];
/**
 * A right band tall enough to hold the whole fraction wherever the footer
 * lands.
 *
 * Kept as an arm, not a candidate. Judged set-wide on 2026-08-25 it wins the
 * read count outright — 269 -> 290, McNemar p<0.001, and WRONG_FULL 2 -> 4 —
 * and the two extra wrong reads went on to be two real false accepts under
 * eval:tune (dp2-113 -> dp3-120, ex13-54 -> bw7-98). Same shape as seam-right,
 * same verdict. It stays here so the next person can reproduce the rejection
 * in twenty minutes instead of rediscovering it in a sorting session.
 */
const TALL_RIGHT: OcrRegion = { x0: 0.5, y0: 0.9, x1: 0.99, y1: 1.0 };

function planOf(
  bands: { region: OcrRegion; opts?: ReadOptions }[],
  escalationRegion: OcrRegion | null,
): CollectorNumberPlan {
  return {
    bands,
    escalation: escalationRegion
      ? { region: escalationRegion, ladder: ESCALATION }
      : undefined,
  };
}

/** Production's five bands, all under one preprocessing setting. */
function uniform(opts: ReadOptions) {
  return OCR.collectorNumber.map((region) => ({ region, opts }));
}

/**
 * Per-band preprocessing: one band gets normalise, the rest keep contrast.
 *
 * This is the only production-expressible form of "hgss wants different
 * treatment" — era cannot be chosen at scan time, it is what the pipeline is
 * trying to determine, but the bands already encode era-specific geometry, so
 * band is a usable proxy for era.
 *
 * Which band was not obvious and the first guess was wrong. Deep-right (index
 * 0) looked right because HS Base prints its number at y≈.952, inside that
 * band — but normalising it alone leaves hgss at 8/97, exactly where
 * production sits, because the band clips the glyph tops and no preprocessing
 * recovers digits that were never in the crop. The reads all-normalise gains
 * on hgss come from somewhere else, so index 1 (mid-right, y .895-.95) gets
 * its own arm.
 */
function bandNormalised(index: number) {
  return OCR.collectorNumber.map((region, i) => ({
    region,
    opts: i === index ? NORMALISE : CONTRAST,
  }));
}

const CONFIGS: { label: string; plan: CollectorNumberPlan }[] = [
  // By reference, so this arm can never drift from what ships.
  { label: "production", plan: productionCollectorPlan(OCR) },
  { label: "all-normalise", plan: planOf(uniform(NORMALISE), DEEP_RIGHT) },
  { label: "all-norm-sharpen", plan: planOf(uniform(NORMALISE_SHARPEN), DEEP_RIGHT) },
  { label: "deepright-norm", plan: planOf(bandNormalised(0), DEEP_RIGHT) },
  { label: "midright-norm", plan: planOf(bandNormalised(1), DEEP_RIGHT) },
  { label: "esc-tall", plan: planOf(uniform(CONTRAST), TALL_RIGHT) },
  { label: "esc-tall+mr-norm", plan: planOf(bandNormalised(1), TALL_RIGHT) },
  { label: "esc-tall+all-norm", plan: planOf(uniform(NORMALISE), TALL_RIGHT) },
  { label: "no-escalation", plan: planOf(uniform(CONTRAST), null) },
];

// ------------------------------------------------------------------ probes

interface Probe {
  file: string;
  id: string;
  era: string;
  truth: RerankInput;
  rivals: RerankInput[];
}

const stripZeros = (v: string) => v.replace(/^0+(?=\d)/, "");

interface ManifestCard {
  id: string;
  name: string;
  setCode: string;
  file?: string;
  collectorNumber?: string | null;
  setTotal?: number | null;
}

/**
 * Truth comes from the manifest, which carries the catalog's printed number
 * and official set total. It used to be derived here — the number from the
 * card id's last segment, the total from the probe's own candidate list — and
 * both were wrong in ways that biased the result: the id suffix is not the
 * printed number on promo sets, and the candidate list has no total at all
 * when the true card fell outside the top 50. That second one is the
 * dangerous one, because falling outside the top 50 is what embedding-weak
 * probes do, and embedding-weak is exactly the population under treatment.
 */
function truthOf(card: ManifestCard): RerankInput {
  return {
    id: card.id,
    distance: 0,
    name: card.name,
    collectorNumber:
      card.collectorNumber ?? stripZeros(card.id.split("-").pop() ?? ""),
    setTotal: card.setTotal ?? null,
    hp: null,
    setAbbreviation: null,
  };
}

async function loadProbes(): Promise<Probe[]> {
  const [manifestRaw, signalsRaw] = await Promise.all([
    readFile(path.join(FIXTURES, "manifest.json"), "utf-8"),
    readFile(SIGNALS_PATH, "utf-8"),
  ]);
  const manifest = JSON.parse(manifestRaw) as { cards: ManifestCard[] };
  const { captures } = JSON.parse(signalsRaw) as {
    captures: { expectedId: string; file?: string; candidates: RerankInput[] }[];
  };

  // Renders are named by id; real captures by scan guid.
  const byFile = new Map<string, RerankInput[]>();
  for (const c of captures) {
    byFile.set(c.file ?? `${c.expectedId}.jpg`, c.candidates);
  }

  // Digital-only printings are never physically scanned.
  const POCKET = /^(A\d|B\d|P-A)/;
  const probes: Probe[] = [];
  for (const card of manifest.cards) {
    if (POCKET.test(card.id)) continue;
    const file = card.file ?? `${card.id}.jpg`;
    const candidates = byFile.get(file);
    if (!candidates) continue; // no signals dump entry — nothing to score rivals against
    const truth = truthOf(card);
    // build-fixtures.ts (the degraded renders) writes no truth total, so fall
    // back to the candidate list there. It is the weaker source — null whenever
    // the true card missed the top 50 — but on renders that is rare, and a
    // truth with no setTotal can never score 1, which would read as "this band
    // reads nothing" rather than "the harness has no answer to check against".
    if (truth.setTotal == null) {
      truth.setTotal = candidates.find((c) => c.id === card.id)?.setTotal ?? null;
    }
    probes.push({
      file,
      id: card.id,
      era: card.setCode.replace(/[\d.]+$/, "") || card.setCode,
      truth,
      rivals: candidates.filter((c) => c.id !== card.id),
    });
  }
  return probes;
}

/**
 * Caps the probe list while keeping every era represented, by taking from each
 * era in turn until the cap is met. A plain slice would return nothing but pl
 * and bw.
 *
 * Within an era, distinct cards come before repeat scans of a card already
 * taken. Repeats are not independent samples — the same physical card in the
 * same session shares its lighting and framing — so a cap that fills up on one
 * card scanned nine times buys resolution it cannot spend. The full set keeps
 * every repeat, which is right: repeats do measure lighting robustness.
 *
 * Each era's probes are spread first, deterministically. The manifest comes out
 * of build-real-fixtures ORDER BY created_at, so the head of an era is the
 * oldest review session — one set of lighting, and the run where repeat scans
 * of the same card cluster.
 */
function stratify(probes: Probe[], cap: number): Probe[] {
  if (!cap || cap >= probes.length) return probes;
  const byEra = new Map<string, Probe[]>();
  for (const p of probes) {
    const list = byEra.get(p.era);
    if (list) list.push(p);
    else byEra.set(p.era, [p]);
  }
  // Fixed seed: the same cap has to select the same probes every run, or two
  // sweeps are not comparable.
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const queues = [...byEra.values()].map((q) => {
    const shuffled = [...q];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // Stable partition: first sighting of each card, then the repeats.
    const seen = new Set<string>();
    const first: Probe[] = [];
    const rest: Probe[] = [];
    for (const p of shuffled) {
      if (seen.has(p.id)) rest.push(p);
      else {
        seen.add(p.id);
        first.push(p);
      }
    }
    return [...first, ...rest];
  });
  const out: Probe[] = [];
  for (let i = 0; out.length < cap; i++) {
    let took = false;
    for (const q of queues) {
      if (i >= q.length) continue;
      out.push(q[i]);
      took = true;
      if (out.length === cap) break;
    }
    if (!took) break;
  }
  return out;
}

// ----------------------------------------------------------------- scoring

interface ProbeResult {
  file: string;
  id: string;
  era: string;
  right: boolean;
  half: boolean;
  wrongFull: boolean;
  denomParsed: boolean;
  denomRight: boolean;
  parsedNum: string | null;
  parsedTotal: number | null;
}

/**
 * Scores one reading in the units the accept gate actually consumes, by
 * running the real `collectorNumberMatch` against the true card and against
 * every rival the retrieval stage returned for this capture.
 *
 * WRONG_FULL is the metric this harness was missing. A garbled read that
 * matches nothing is harmless noise the fusion renormalises away; a garbled
 * read that lands on a real candidate is a false accept waiting to happen.
 * dp2-113 misread as "120/132" was only dangerous because dp3-120 was in the
 * list. Scoring against the stored top-50 is the correct scope, not a
 * limitation of it: a false accept can only ever come from a candidate.
 */
function scoreReading(
  probe: Probe,
  reading: Awaited<ReturnType<typeof readCollectorNumber>>,
): ProbeResult {
  const truthScore = collectorNumberMatch(reading, probe.truth);
  let rivalMax = 0;
  for (const rival of probe.rivals) {
    const s = collectorNumberMatch(reading, rival);
    if (s > rivalMax) rivalMax = s;
  }
  return {
    file: probe.file,
    id: probe.id,
    era: probe.era,
    right: truthScore === 1,
    half: truthScore === 0.5,
    wrongFull: rivalMax === 1 && truthScore < 1,
    denomParsed: reading.setTotal != null,
    denomRight:
      reading.setTotal != null && reading.setTotal === probe.truth.setTotal,
    parsedNum: reading.collectorNumber ?? null,
    parsedTotal: reading.setTotal ?? null,
  };
}

async function runConfig(
  probes: Probe[],
  plan: CollectorNumberPlan,
): Promise<ProbeResult[]> {
  const out: ProbeResult[] = new Array(probes.length);
  // The OCR pool (OCR_POOL_SIZE) is what actually parallelises the reads; this
  // just keeps enough plans in flight to keep every worker busy.
  const lanes = Math.max(2, Number(process.env.OCR_POOL_SIZE) || 2);
  let next = 0;
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      for (let i = next++; i < probes.length; i = next++) {
        const probe = probes[i];
        const image = sharp(await readFile(path.join(FIXTURES, probe.file)));
        const meta = await image.metadata();
        const reading = await readCollectorNumber(
          image,
          meta.width ?? 0,
          meta.height ?? 0,
          plan,
        );
        out[i] = scoreReading(probe, reading);
      }
    }),
  );
  return out;
}

function summarise(results: ProbeResult[]) {
  const byEra = new Map<string, { n: number; right: number; wrong: number }>();
  let right = 0;
  let half = 0;
  let wrongFull = 0;
  let denomParsed = 0;
  let denomRight = 0;
  for (const r of results) {
    if (r.right) right++;
    if (r.half) half++;
    if (r.wrongFull) wrongFull++;
    if (r.denomParsed) denomParsed++;
    if (r.denomRight) denomRight++;
    const e = byEra.get(r.era) ?? { n: 0, right: 0, wrong: 0 };
    e.n++;
    if (r.right) e.right++;
    if (r.wrongFull) e.wrong++;
    byEra.set(r.era, e);
  }
  return { right, half, wrongFull, denomParsed, denomRight, byEra };
}

async function main() {
  const all = await loadProbes();
  const raw = process.env.EVAL_SAMPLE;
  const cap = raw == null ? 0 : Number(raw);
  if (raw != null && (!Number.isInteger(cap) || cap <= 0)) {
    throw new Error(`EVAL_SAMPLE must be a positive integer, got "${raw}"`);
  }
  const probes = stratify(all, cap);
  const distinct = new Set(probes.map((p) => p.id)).size;

  console.log(
    `${EVAL_SET}: ${probes.length} probes of ${all.length} (${distinct} distinct cards)`,
  );
  if (probes.length < all.length) {
    console.log(
      "SAMPLED — benefit numbers only. WRONG_FULL needs the full set (unset EVAL_SAMPLE).",
    );
  }
  console.log(
    `pool=${Number(process.env.OCR_POOL_SIZE) || 2} (set OCR_POOL_SIZE to cores-1)\n`,
  );

  await mkdir(DUMP_DIR, { recursive: true });

  // A full grid over the real set is ~25 minutes; SWEEP_ONLY runs a subset so
  // it can be done in batches, and dumps from earlier batches stay on disk for
  // ocr-compare. Labels are comma-separated and must match CONFIGS exactly.
  const only = process.env.SWEEP_ONLY?.split(",").map((x) => x.trim()).filter(Boolean);
  const configs = only ? CONFIGS.filter((c) => only.includes(c.label)) : CONFIGS;
  if (only) {
    const unknown = only.filter((l) => !CONFIGS.some((c) => c.label === l));
    if (unknown.length > 0) {
      throw new Error(`SWEEP_ONLY names no such config: ${unknown.join(", ")}`);
    }
  }

  console.log(
    "config".padEnd(20) +
      "RIGHT".padStart(8) +
      "HALF".padStart(7) +
      "WRONG".padStart(7) +
      "denom".padStart(11) +
      "  secs",
  );
  for (const cfg of configs) {
    const t0 = Date.now();
    const results = await runConfig(probes, cfg.plan);
    const s = summarise(results);
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(
      cfg.label.padEnd(20) +
        `${s.right}/${probes.length}`.padStart(8) +
        String(s.half).padStart(7) +
        String(s.wrongFull).padStart(7) +
        `${s.denomRight}/${s.denomParsed}`.padStart(11) +
        `  ${secs}s`,
    );
    const era = [...s.byEra.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .map(([k, v]) => `${k} ${v.right}/${v.n}${v.wrong ? ` W${v.wrong}` : ""}`)
      .join("  ");
    console.log(`  ${era}`);
    // Per-probe, so two configs can be compared as paired data. Marginals
    // alone cannot: 7/97 versus 17/97 is anywhere from p=0.002 to p=0.064
    // depending on how the two sets overlap, and only the overlap settles it.
    await writeFile(
      path.join(DUMP_DIR, `${EVAL_SET}-${cfg.label}.jsonl`),
      results.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
  }

  console.log(`\nper-probe dumps in ${DUMP_DIR}`);
  console.log("compare two configs: pnpm exec tsx eval/ocr-compare.ts <a> <b>");
  await disposeOcr();
  process.exit(0);
}

main();
