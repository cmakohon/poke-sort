/**
 * Identifies which embedding pipeline produced a vector.
 *
 * Vectors are only comparable to other vectors made the same way. Change the
 * model, the quantisation, or how the image is preprocessed, and every stored
 * embedding becomes incomparable to a freshly computed one — but nothing would
 * fail loudly. Distances would just get slightly worse across the board, which
 * looks like a mediocre model rather than a broken catalog.
 *
 * A pack that records this can be rejected on import instead.
 */
import { ART_WINDOW_VERSION } from "./art-window";

export const MODEL_NAME = "Xenova/siglip-base-patch16-512";
export const MODEL_DTYPE = "q8";
export const EMBEDDING_DIM = 768;

/**
 * Bump whenever the bytes fed to the model change — crop geometry, resizing,
 * colour normalisation. Phase 4h is expected to bump this, and doing so
 * invalidates every existing pack by design.
 */
export const PREPROCESSING_VERSION = 1;

export interface EmbeddingIdentity {
  model: string;
  dtype: string;
  dim: number;
  preprocessing: number;
  /**
   * Which art windows produced the second vector (lib/art-window.ts).
   *
   * Separate from `preprocessing` because it describes a different vector:
   * changing a window leaves every whole-card embedding valid, so folding it
   * in would invalidate packs for no reason. Same failure mode though — an art
   * vector cropped one way is not comparable to a query cropped another, and
   * nothing would fail loudly.
   */
  artWindows: number;
}

export const EMBEDDING_IDENTITY: EmbeddingIdentity = {
  model: MODEL_NAME,
  dtype: MODEL_DTYPE,
  dim: EMBEDDING_DIM,
  preprocessing: PREPROCESSING_VERSION,
  artWindows: ART_WINDOW_VERSION,
};

/** Human-readable reason a pack cannot be used, or null if it can. */
export function incompatibilityReason(
  packIdentity: Partial<EmbeddingIdentity> | undefined,
): string | null {
  if (!packIdentity) {
    return "This pack predates embedding identity tagging and cannot be verified as compatible.";
  }
  const mismatches: string[] = [];
  for (const key of ["model", "dtype", "dim", "preprocessing", "artWindows"] as const) {
    const expected = EMBEDDING_IDENTITY[key];
    const actual = packIdentity[key];
    if (actual !== undefined && actual !== expected) {
      mismatches.push(`${key}: pack has ${actual}, app expects ${expected}`);
    }
  }
  return mismatches.length > 0
    ? `Pack was built with a different embedding pipeline (${mismatches.join("; ")}). ` +
        "Importing it would silently degrade every match."
    : null;
}
