import type {
  IdentifyCandidate,
  IdentifySignals,
  IdentifyTier,
  OcrReading,
} from "@poke-sort/shared";
import { isTrustworthySetTotal } from "../set-index";
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
  /**
   * Cosine distance between the capture's art window and this card's, or null
   * when the catalog has no art vector for it (a pre-v4 pack, or a series with
   * no window). Optional so the eval fixtures and unit tests that predate it
   * keep type-checking.
   */
  artDistance?: number | null;
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
  // A full fraction was read and its denominator names a DIFFERENT REAL SET:
  // the numerator agreeing is then evidence AGAINST this candidate, not weak
  // evidence for it. Half-crediting it promoted a same-numbered reprint over
  // the true card on a real capture ("53/18" misread of 83/108 boosting the
  // #53 printing — 18 is a real total, Trick or Trade 2023) — and at looser
  // gates that same mode produced false accepts.
  //
  // "Real set" is the whole qualifier, and it used not to be there. A
  // denominator no card prints is not a rival set's number, it is OCR noise
  // that happened to sit after a slash, and letting it zero the signal threw
  // away a numerator that had been read correctly. 43 of the 956 labelled real
  // captures hit this branch with the right numerator, and 35 of those named a
  // total that fails isTrustworthySetTotal — mostly a bare "1" or "11", a
  // fragment of the real fraction. Those fall through to half credit now,
  // which is what a numerator on its own has always been worth.
  if (
    ocr.setTotal != null &&
    candidate.setTotal != null &&
    isTrustworthySetTotal(ocr.setTotal)
  ) {
    return 0;
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

/**
 * Whether the denominator OCR read names a set of the candidate's size.
 *
 * This is the collector number's other half, and it is worth having on its own
 * because the two halves fail independently. The numerator is three small
 * digits unique to one card; the denominator is the same digits on every card
 * in the set, so it is both easier to read and easier to corroborate. On the
 * labelled hgss captures the denominator survives more often than the full
 * fraction does.
 *
 * What it buys: a denominator cuts ~150 sets down to one or two ("/90" is
 * hgss3 alone; "/123" is dp2 or hgss1), which is most of the way to splitting
 * the same-name reprint pairs the embedding cannot. On the 28 labelled hgss
 * mis-identifications the true card and the card that beat it print different
 * denominators in 24.
 *
 * Deliberately its own signal rather than another branch inside
 * collectorNumberMatch. Two reasons, both about being able to undo it: `fuse`
 * renormalises per key, so folding it in would let a bare denominator move
 * scores at the collector number's full weight, and a separate key means the
 * revert is `weight: 0` — something eval:tune can select on its own, unlike
 * the band geometry that had to be reverted by hand in 5526f2e.
 *
 * Gated on isTrustworthySetTotal for the same reason collectorNumberMatch is:
 * ungated, the denominator is right about 63% of the time it parses, and a
 * signal that confident-wrong a third of the time is not evidence.
 *
 * Note what it cannot do: every card in a set prints the same denominator, so
 * this never separates two candidates from the SAME set, and because `fuse`
 * renormalises it slightly compresses their margin when it fires. That is not
 * hypothetical — on the labelled set it takes pl4-64 from accept to review,
 * its rivals being other pl4 cards. The trade is worth it (net +1 accept,
 * zero false accepts, and the card it costs is held rather than mis-sorted)
 * but it is why the weight is 0.02 and not something that would matter.
 */
export function setTotalMatch(ocr: OcrReading, candidate: RerankInput): number {
  if (ocr.setTotal == null || candidate.setTotal == null) return 0;
  if (!isTrustworthySetTotal(ocr.setTotal)) return 0;
  return ocr.setTotal === candidate.setTotal ? 1 : 0;
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
  // Two views of the same card, fused before they become one signal.
  //
  // The whole-card embedding is dominated by the frame, which is identical
  // across a set, so same-name reprints land inside the margin gate. The art
  // window separates them but is worse where the frame carried real
  // information, so neither replaces the other — blending beats both.
  //
  // Deliberately NOT a separate SignalKey. `fuse` computes ONE informative
  // mask for the whole candidate set, so an `art` key would score 0 for every
  // card the catalog happens to lack a vector for, punishing it for something
  // it could not do — the exact failure the comment on `fuse` below describes.
  // Folded in here, a missing art vector simply leaves the whole-card distance
  // untouched.
  const distance =
    candidate.artDistance == null
      ? candidate.distance
      : (1 - profile.artWeight) * candidate.distance +
        profile.artWeight * candidate.artDistance;

  // Distance 0 -> 1.0, distance at the cutoff -> 0.0.
  const embedding = Math.max(
    0,
    Math.min(1, 1 - distance / profile.distanceCutoff),
  );
  const signals: IdentifySignals = {
    embedding,
    name: nameSimilarity(ocr.name, candidate.name),
    collectorNumber: collectorNumberMatch(ocr, candidate),
    setAbbreviation: setAbbreviationMatch(ocr, candidate),
    setTotal: setTotalMatch(ocr, candidate),
    hp: hpMatch(ocr, candidate),
  };

  return { score: fuse(signals, profile, ALL_SIGNALS), signals };
}

export type SignalKey = keyof IdentifySignals;

export const ALL_SIGNALS = [
  "embedding",
  "name",
  "collectorNumber",
  "setAbbreviation",
  "setTotal",
  "hp",
] as const satisfies readonly SignalKey[];

/**
 * Compile error if a signal is added to IdentifySignals and not listed above.
 *
 * Worth the two lines: the list is duplicated in eval/tune.ts's replay, and a
 * key present in one and missing from the other produces a tuning run that
 * looks fine and optimises the wrong function. Nothing else would catch it.
 */
type MissingSignal = Exclude<SignalKey, (typeof ALL_SIGNALS)[number]>;
const _allSignalsComplete: MissingSignal extends never ? true : never = true;
void _allSignalsComplete;

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
  informative: readonly SignalKey[],
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
function informativeSignals(all: IdentifySignals[]): readonly SignalKey[] {
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
    // minScore still applies: this valve exists to relax a thin MARGIN, not
    // the floor on how much evidence there has to be in the first place.
    // Without it a card can be released below minScore with OCR actively
    // disagreeing, purely on being the nearest picture.
    if (
      top >= profile.accept.minScore &&
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
