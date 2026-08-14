import type { ReviewCardSync, ScannedCard } from "@poke-sort/shared";

/**
 * Folds a review-screen verdict into a card already on screen.
 *
 * Neither card list refetches after a verdict — the scan screen's staged list
 * is plain React state and the collection screen's is a React Query cache — so
 * the verdict endpoint returns the card's new state and it gets patched in
 * here. Shared by both so a verdict looks the same wherever the card lives.
 */
export function mergeReviewSync(
  card: ScannedCard,
  sync: ReviewCardSync,
): ScannedCard {
  return {
    ...card,
    ...(sync.card ? { card: sync.card } : {}),
    needsReview: sync.needsReview,
    wasCorrected: sync.wasCorrected,
    originalCardId: sync.originalCardId ?? undefined,
    originalDistance: sync.originalDistance ?? undefined,
    originalScore: sync.originalScore ?? undefined,
    reviewVerdict: sync.reviewVerdict,
  };
}
