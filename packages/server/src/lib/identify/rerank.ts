import type {
  IdentifyCandidate,
  IdentifySignals,
  IdentifyTier,
  OcrReading,
} from "@poke-sort/shared";
import type { IdentityProfile } from "./profiles";

/**
 * Fuses the image embedding with whatever OCR managed to read.
 *
 * The embedding alone cannot separate reprints: the same art, printed in a
 * different set, is the same picture. The collector number can, which is why
 * it carries as much weight as the name despite being read less often.
 */

export interface RerankInput {
  id: string;
  distance: number;
  name: string;
  collectorNumber: string | null;
  setTotal: number | null;
  hp: number | null;
  /** Printed set code, e.g. "OBF". Null for sets that never printed one. */
  setAbbreviation: string | null;
}

/** Levenshtein, iterative with two rows — these strings are short. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** 1.0 identical, 0.0 unrelated. */
export function nameSimilarity(a: string | undefined, b: string): number {
  if (!a) return 0;
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  const longest = Math.max(left.length, right.length);
  return Math.max(0, 1 - editDistance(left, right) / longest);
}

/** Leading zeros are a printing convention, not part of the identity. */
const stripZeros = (v: string) => v.replace(/^0+(?=\d)/, "").toLowerCase();

/**
 * Glyphs OCR reliably mistakes for digits (or the slash) in the tiny
 * bottom-band number print. A real capture came back with "020/094" read as
 * "oz0r09a0" — o for 0, z for 2, r for /, a for 4. Applied only inside
 * collector-number matching, and only to runs that are already mostly digits
 * (see digitNormalizedRuns): normalizing letters wholesale would turn prose
 * like "creatures/gamefreak" into digit soup and hand out false matches.
 */
const DIGIT_CONFUSABLES: Record<string, string> = {
  o: "0",
  i: "1",
  l: "1",
  "|": "1",
  z: "2",
  a: "4",
  s: "5",
  b: "8",
  g: "9",
  r: "/",
  "\\": "/",
};

const CONFUSABLE_RUN = /[0-9/oil|zasbgr\\]{4,}/g;

/**
 * Substrings of the raw reading that look like a garbled number: runs of
 * digit-ish characters at least half of which are true digits, with the
 * confusable glyphs mapped back to digits.
 */
function digitNormalizedRuns(compactRaw: string): string[] {
  const runs = compactRaw.match(CONFUSABLE_RUN) ?? [];
  return runs
    .filter((run) => run.replace(/[^0-9]/g, "").length * 2 >= run.length)
    .map((run) =>
      run.replace(/[oil|zasbgr\\]/g, (ch) => DIGIT_CONFUSABLES[ch] ?? ch),
    );
}

/**
 * 1.0 when the printed number matches in full ("58" of "58/102"), 0.5 when
 * only the card's own number matches, 0 otherwise.
 *
 * The half-credit case matters: OCR frequently reads "58" cleanly but mangles
 * the denominator, and "58" alone still eliminates most of the candidate set.
 */
export function collectorNumberMatch(
  ocr: OcrReading,
  candidate: RerankInput,
): number {
  if (!candidate.collectorNumber) return 0;

  // Strongest evidence: the candidate's full printed number appears verbatim in
  // the raw reading. Survives the leading/trailing noise OCR adds around it,
  // which an exact parse comparison does not.
  if (ocr.collectorNumberRaw && candidate.setTotal != null) {
    const compact = (v: string) => v.replace(/\s+/g, "");
    const raw = compact(ocr.collectorNumberRaw.toLowerCase());
    // Two printed conventions: older sets print the number bare ("58/102"),
    // modern sets zero-pad both halves to the numerator's width ("020/094").
    // The bare form alone could never match a modern card — "020/094" does
    // not contain "20/94" — which silenced this signal for exactly the
    // recent-reprint cases it exists to separate.
    const total = String(candidate.setTotal);
    const printedForms = [
      `${stripZeros(candidate.collectorNumber)}/${total}`,
      `${candidate.collectorNumber.toLowerCase()}/${total.padStart(
        candidate.collectorNumber.length,
        "0",
      )}`,
    ];
    const normalizedRuns = digitNormalizedRuns(raw);
    for (const printed of printedForms) {
      if (raw.includes(printed)) return 1;
      if (normalizedRuns.some((run) => run.includes(printed))) return 1;
    }
  }

  if (!ocr.collectorNumber) return 0;
  if (stripZeros(ocr.collectorNumber) !== stripZeros(candidate.collectorNumber)) {
    return 0;
  }

  if (
    ocr.setTotal != null &&
    candidate.setTotal != null &&
    ocr.setTotal === candidate.setTotal
  ) {
    return 1;
  }
  return 0.5;
}

/**
 * Whether the candidate's printed set code appears in the bottom-band text.
 *
 * Reprints share art, name and often HP, but never a set — so this separates
 * exactly the cases the embedding cannot. Matched against the raw reading
 * rather than a parse, for the same reason the collector number is: OCR
 * surrounds it with noise but rarely mangles the letters themselves.
 *
 * Requires 2+ characters and a boundary, so a two-letter code like "XY" cannot
 * be matched out of the middle of an unrelated word.
 */
export function setAbbreviationMatch(
  ocr: OcrReading,
  candidate: RerankInput,
): number {
  const abbrev = candidate.setAbbreviation;
  if (!abbrev || abbrev.length < 2 || !ocr.collectorNumberRaw) return 0;
  const pattern = new RegExp(
    `(^|[^A-Za-z])${abbrev.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z]|$)`,
    "i",
  );
  return pattern.test(ocr.collectorNumberRaw) ? 1 : 0;
}

function hpMatch(ocr: OcrReading, candidate: RerankInput): number {
  if (ocr.hp == null || candidate.hp == null) return 0;
  return ocr.hp === candidate.hp ? 1 : 0;
}

export function scoreCandidate(
  candidate: RerankInput,
  ocr: OcrReading,
  profile: IdentityProfile,
): { score: number; signals: IdentifySignals } {
  // Distance 0 -> 1.0, distance at the cutoff -> 0.0.
  const embedding = Math.max(
    0,
    Math.min(1, 1 - candidate.distance / profile.distanceCutoff),
  );
  const signals: IdentifySignals = {
    embedding,
    name: nameSimilarity(ocr.name, candidate.name),
    collectorNumber: collectorNumberMatch(ocr, candidate),
    setAbbreviation: setAbbreviationMatch(ocr, candidate),
    hp: hpMatch(ocr, candidate),
  };

  return { score: fuse(signals, profile, ALL_SIGNALS), signals };
}

export type SignalKey = keyof IdentifySignals;

const ALL_SIGNALS: SignalKey[] = [
  "embedding",
  "name",
  "collectorNumber",
  "setAbbreviation",
  "hp",
];

/**
 * Weighted mean over the signals that carry information, renormalised so the
 * absent ones neither help nor hurt.
 *
 * A plain weighted sum punishes a card for what OCR failed to do. Two ways that
 * bites, both seen in the fixture run:
 *
 *  - Nothing read at all: a perfect image match caps at the embedding weight
 *    (0.45) and lands under the accept threshold, so an unambiguous card is
 *    sent to a human anyway.
 *  - Noise read: Tesseract almost always emits *something* for the number
 *    region ("01995969899"), which looks like an available signal, matches no
 *    candidate, and drags every score down equally. This was 25% of fixtures —
 *    all with the correct card ranked first, and margins as wide as 0.38.
 *
 * A signal that disagrees with a specific candidate still scores 0 for it —
 * that is evidence against, and quite different from no evidence at all.
 */
function fuse(
  signals: IdentifySignals,
  profile: IdentityProfile,
  informative: SignalKey[],
): number {
  const w = profile.weights;
  let mass = 0;
  let total = 0;
  for (const key of informative) {
    mass += w[key];
    total += w[key] * signals[key];
  }
  return mass > 0 ? total / mass : 0;
}

/**
 * A signal is informative only if it separates the candidates. If an OCR
 * reading matches nothing in the whole candidate set, it is noise, not
 * evidence — including it just adds a constant penalty to everyone.
 */
function informativeSignals(all: IdentifySignals[]): SignalKey[] {
  return ALL_SIGNALS.filter((key) =>
    key === "embedding" ? true : all.some((s) => s[key] > 0),
  );
}

/**
 * Decides what to do with the ranked list.
 *
 * The margin between #1 and #2 is as important as the absolute score and was
 * previously computed and thrown away: two candidates at 0.8 mean the pipeline
 * cannot tell them apart, however confident either looks alone.
 */
export function decideTier(
  ranked: { id: string; score: number; distance: number }[],
  profile: IdentityProfile,
): { tier: IdentifyTier; margin: number | null } {
  if (ranked.length === 0) return { tier: "no-match", margin: null };

  const top = ranked[0].score;
  const margin = ranked.length > 1 ? top - ranked[1].score : null;

  if (top < profile.reviewFloor) return { tier: "no-match", margin };

  const clearOfRunnerUp = margin == null || margin >= profile.accept.minMargin;
  if (top >= profile.accept.minScore && clearOfRunnerUp) {
    return { tier: "accept", margin };
  }

  // Image-unambiguous release: the fused margin compresses large embedding
  // gaps (a candidate 0.04 away and one 0.15 away can fuse within 0.05 of each
  // other once OCR noise is renormalised in), so a card whose nearest image
  // match is BOTH very close and far ahead of the next distinct card can sit
  // in review with the right answer ranked first. When the fused top IS that
  // nearest match, the picture alone has decided; accept it.
  const dg = profile.accept.distanceGap;
  if (dg) {
    const byDistance = [...ranked].sort((a, b) => a.distance - b.distance);
    const nearest = byDistance[0];
    const next = byDistance[1];
    if (
      nearest.id === ranked[0].id &&
      nearest.distance <= dg.d1Max &&
      (next ? next.distance - nearest.distance : Infinity) >= dg.gapMin
    ) {
      return { tier: "accept", margin };
    }
  }
  return { tier: "review", margin };
}

export function rerank(
  candidates: RerankInput[],
  ocr: OcrReading,
  profile: IdentityProfile,
): Omit<IdentifyCandidate, "card">[] {
  // Two passes: signals first, because whether a signal is worth counting is a
  // property of the candidate set as a whole, not of any one candidate.
  const scored = candidates.map((c) => ({
    input: c,
    signals: scoreCandidate(c, ocr, profile).signals,
  }));
  const informative = informativeSignals(scored.map((s) => s.signals));

  return scored
    .map(({ input, signals }) => ({
      id: input.id,
      distance: input.distance,
      score: fuse(signals, profile, informative),
      signals,
    }))
    .sort((a, b) => b.score - a.score || a.distance - b.distance);
}
