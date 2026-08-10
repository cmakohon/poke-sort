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
  /** Restrict Tesseract's alphabet; hugely reduces misreads on numerics. */
  charset?: string;
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
  /** How many nearest neighbours to re-rank. */
  candidateLimit: number;
  /** Candidates further than this are not considered at all. */
  distanceCutoff: number;
  weights: {
    embedding: number;
    name: number;
    collectorNumber: number;
    hp: number;
  };
  /** Sort as-is only when both hold; otherwise the card goes to review. */
  accept: { minScore: number; minMargin: number };
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
  // Bottom-right on classic and modern layouts; bottom-LEFT on e-Card and
  // several promos, which is why both are tried.
  collectorNumber: [
    { x0: 0.55, y0: 0.9, x1: 0.98, y1: 0.99, charset: "0123456789/" },
    { x0: 0.02, y0: 0.9, x1: 0.45, y1: 0.99, charset: "0123456789/" },
    // SV-era promos print an alphanumeric code (e.g. "SVP 001").
    { x0: 0.55, y0: 0.88, x1: 0.98, y1: 0.99 },
  ],
  hp: [{ x0: 0.6, y0: 0.03, x1: 0.98, y1: 0.12, charset: "0123456789HP" }],
};

export const POKEMON_PROFILE: IdentityProfile = {
  gameKey: "pokemon",
  // Was 5. For a name printed across dozens of sets the right answer routinely
  // sits below rank 5 on embedding distance alone, so re-ranking never saw it.
  candidateLimit: 50,
  distanceCutoff: 0.3,
  // Starting weights, to be tuned against the eval harness rather than treated
  // as final. The collector number is the strongest signal when OCR reads it,
  // but OCR fails often enough that the embedding still has to carry the run.
  weights: {
    embedding: 0.45,
    name: 0.25,
    collectorNumber: 0.25,
    hp: 0.05,
  },
  accept: { minScore: 0.6, minMargin: 0.08 },
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
