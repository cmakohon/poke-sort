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
}

export const EMBEDDING_IDENTITY: EmbeddingIdentity = {
  model: MODEL_NAME,
  dtype: MODEL_DTYPE,
  dim: EMBEDDING_DIM,
  preprocessing: PREPROCESSING_VERSION,
};

/** Human-readable reason a pack cannot be used, or null if it can. */
export function incompatibilityReason(
  packIdentity: Partial<EmbeddingIdentity> | undefined,
): string | null {
  if (!packIdentity) {
    return "This pack predates embedding identity tagging and cannot be verified as compatible.";
  }
  const mismatches: string[] = [];
  for (const key of ["model", "dtype", "dim", "preprocessing"] as const) {
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
