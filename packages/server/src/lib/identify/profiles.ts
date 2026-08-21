import { digitalOnlySetIds } from "../set-index";

/**
 * Per-game identification profiles.
 *
 * Pokemon is the game this sorter is actually used for, and it is the hardest:
 * a Pikachu printed in forty sets gives forty near-identical art crops. Rather
 * than special-casing Pokemon throughout the pipeline, each game gets a profile
 * and games without one keep exactly today's behaviour.
 *
 * Mirrors the ADAPTERS_BY_GAME_KEY pattern in lib/card-search/resolve.ts.
 */

export interface OcrRegion {
  /** Fractions of the crop, 0..1. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrProfile {
  /**
   * Pokemon layouts moved around across two decades of sets. Rather than
   * detecting the era first — itself an error-prone guess — every region in
   * each list is read and the best-formed parse wins.
   */
  name: OcrRegion[];
  collectorNumber: OcrRegion[];
  hp: OcrRegion[];
}

export interface IdentityProfile {
  gameKey: string;
  /**
   * Sets a physical scan can never be: digital-only printings. They stay in
   * the catalog for search and pricing, but as identification candidates they
   * are pure noise — near-perfect embedding twins of their physical reprints.
   */
  excludedSetIds: string[];
  /** How many nearest neighbours to re-rank. */
  candidateLimit: number;
  /** Candidates further than this are not considered at all. */
  distanceCutoff: number;
  weights: {
    embedding: number;
    name: number;
    collectorNumber: number;
    setAbbreviation: number;
    hp: number;
  };
  /** Sort as-is only when both hold; otherwise the card goes to review. */
  accept: {
    minScore: number;
    minMargin: number;
    /**
     * A release valve for the same-name-reprint pile: when the nearest
     * embedding match is very close AND clearly separated from the next
     * candidate, the image alone is unambiguous and a thin FUSED margin (which
     * compresses large distance gaps) should not hold the card hostage.
     */
    distanceGap?: { d1Max: number; gapMin: number };
  };
  /** Below this, treat as no match rather than asking a human. */
  reviewFloor: number;
  ocr?: OcrProfile;
}

const POKEMON_OCR: OcrProfile = {
  // Name sits in a top band on every era, though it shifts with the HP box.
  name: [
    { x0: 0.06, y0: 0.045, x1: 0.72, y1: 0.13 },
    { x0: 0.14, y0: 0.05, x1: 0.7, y1: 0.12 },
  ],
  /**
   * Bands measured against real cards rather than guessed, because the printed
   * number moved sides partway through the game's history: WOTC through XY put
   * it bottom-RIGHT, Sword & Shield onward bottom-LEFT, and Scarlet & Violet
   * reads most reliably from a full-width strip. Hit rates from a per-era sweep
   * (4 cards each, so directional not precise):
   *
   *   era    R .90-.97   L .90-.97   W .92-1.0
   *   base      2/4         0/4         0/4
   *   bw        3/4         0/4         2/4
   *   xy        3/4         0/4         2/4
   *   swsh      0/4         3/4         2/4
   *   sv        0/4         1/4         4/4
   *
   * The previous bands started at y=0.90 and ran to 0.99, which mostly caught
   * the rules and copyright text sitting above the number — a crop returning
   * "When your Pokemon is Knocked Out..." rather than "125/197".
   *
   * No charset restriction: the digits-only whitelist was telling Tesseract to
   * discard the set abbreviation ("OBF", "SSH") printed right beside the
   * number, which is a second, independent signal for which set a card is from.
   */
  // A seam-spanning right band (y .92-.985) reads 47 more collector numbers on
  // the 956-probe real set — pl +30, dp +7 — and it was reverted anyway: those
  // extra reads cost 2 false accepts, and false accepts are a constraint here,
  // not a term to trade accept rate against.
  //
  // Both failures were a misread number landing exactly on a real card:
  // dp2-113 (printed 113/123) read "120/132", which IS dp3-120, and bw9-43
  // (printed 43/116) read "44", which is xy11-44. In both the truth had the
  // better embedding and lost anyway, because a matched number scores 1.0 and
  // outvotes it. A confidently wrong number is worse than no number, so a
  // wider crop only pays once the digits it adds are trustworthy.
  collectorNumber: [
    // Deep right: dp, base, later-ex, neo print the number at y=.955-.985 —
    // BELOW the band this list used to stop at (y=.97), which cut the digits
    // in half. Verified by cropping fixtures and looking.
    { x0: 0.5, y0: 0.945, x1: 0.99, y1: 0.995 },
    // Mid right: early-ex, xy, bw, sm.
    { x0: 0.5, y0: 0.895, x1: 0.99, y1: 0.95 },
    // Tight bottom-left: just the number line of the swsh/sv/me frames. The
    // taller left band below drags the Illus. line and the set-code icons
    // into the crop, and on the real-capture sweep the narrow crop nearly
    // doubled the me-era hit rate (6/17 -> 11/17) by upsampling the digits
    // harder for the same read.
    { x0: 0.02, y0: 0.915, x1: 0.38, y1: 0.968 },
    // Left: swsh moved the number bottom-left. Kept alongside the tight crop
    // for the frames that print the number above its ceiling.
    { x0: 0.02, y0: 0.9, x1: 0.5, y1: 0.97 },
    // Wide: sv reads most reliably from a full-width strip. Edges trimmed so
    // the rotation border the capture adds cannot dominate normalisation.
    { x0: 0.03, y0: 0.93, x1: 0.97, y1: 0.995 },
  ],
  // No charset restriction here either: per-region Tesseract parameters would
  // pin a region to a specific worker and defeat the pool. parseHp's regex
  // does the filtering instead.
  hp: [{ x0: 0.6, y0: 0.03, x1: 0.98, y1: 0.12 }],
};

export const POKEMON_PROFILE: IdentityProfile = {
  gameKey: "pokemon",
  excludedSetIds: digitalOnlySetIds(),
  // Was 5. For a name printed across dozens of sets the right answer routinely
  // sits below rank 5 on embedding distance alone, so re-ranking never saw it.
  candidateLimit: 50,
  distanceCutoff: 0.3,
  // Tuned against eval/signals.json via eval/tune.ts (150 degraded-render
  // probes, full catalog): 87.3% accept at zero false accepts, held-out
  // 0/3000 across 40 fixed-config splits. Deliberately NOT the sweep argmax —
  // that sat one margin notch from a config with 2 false accepts, and a
  // procedure-level cross-validation showed argmax-picking leaks ~1.4% false
  // accepts on held-out halves. These sit two notches back and cost 2 points
  // of accept rate for it.
  //
  // The embedding carries half the mass because on these probes it is by far
  // the most reliable signal.
  //
  // Re-validated 2026-08-21 against 956 labelled real captures (eval:build-real
  // + EVAL_FIXTURES=pokemon-real, 2026-08 review sessions): top-1 96.5%, 86.4%
  // accept at zero false accepts, 86.9% with distanceGap on — ahead of every
  // config the sweep found once pre-SwSh PTCGO codes stopped feeding the
  // abbreviation signal (see abbreviationOf).
  //
  // This supersedes the earlier 558-probe run (top-1 97.0%), which had 13 dp
  // and 6 hgss probes where this one has 202 and 58 — those eras are most of
  // the review pile, so the older number was flattering. One caveat on the set:
  // the 956 captures cover 438 distinct cards, so repeatedly-scanned cards
  // carry more weight than a per-card set would give them.
  //
  // minMargin 0.04 looked clean on renders but admits real false accepts — one
  // live at margin 0.044, and one notch down costs FALSE=2 on the 558 probes
  // and FALSE=3 on the 956 — so 0.05 stands. The remaining review pile is
  // almost entirely reprint pairs the embedding cannot split; wins there come
  // from reading the collector number, not from loosening the gate.
  weights: {
    embedding: 0.5,
    name: 0.1,
    collectorNumber: 0.2,
    // Decisive when present, but only Sword & Shield onward prints one. The
    // fusion renormalises over the signals actually available, so a card with
    // no printed code is not penalised for it.
    setAbbreviation: 0.05,
    hp: 0.05,
  },
  // distanceGap enabled 2026-08-21, at zero false accepts on every measurement:
  // it releases 5 cards on the 956-probe real set (accept 86.4% -> 86.9%, top-1
  // unchanged), and recovers 11 of the 146 labelled review-tier rows when
  // replayed against the live catalog directly.
  //
  // gapMin is the whole rule — d1Max is not binding, every ceiling from 0.10
  // to 0.44 selects the same cards. The cliff is one notch away rather than
  // the two minMargin keeps: gapMin 0.015 admits 2 false accepts. Deliberate,
  // and worth re-measuring whenever the review pile changes shape.
  accept: {
    minScore: 0.5,
    minMargin: 0.05,
    distanceGap: { d1Max: 0.15, gapMin: 0.02 },
  },
  reviewFloor: 0.3,
  ocr: POKEMON_OCR,
};

const PROFILES_BY_GAME_KEY: Record<string, IdentityProfile> = {
  pokemon: POKEMON_PROFILE,
};

/** null means "behave exactly as before": embedding only, top 5, take the top. */
export function getIdentityProfile(gameKey: string): IdentityProfile | null {
  return PROFILES_BY_GAME_KEY[gameKey] ?? null;
}

/** The pre-profile behaviour, kept explicit so both paths read the same way. */
export const LEGACY_LIMIT = 5;
export const LEGACY_CUTOFF = 0.3;
