import type { PlayingCardWithDistance, ScannedCard } from "@poke-sort/shared";
import { collectionCards } from "../db/schema";
import { captureUrl } from "./captures";

/**
 * Shared shape for reading collection cards.
 *
 * There used to be one of these per call site, and they drifted: the monitor
 * stream's `session_init` select omitted review_verdict, so a watcher never saw
 * the reviewed badge until the next card_updated arrived. One definition means
 * a column added here reaches every reader.
 */
export const CARD_COLUMNS = {
  guid: collectionCards.guid,
  card: collectionCards.card,
  scannedAt: collectionCards.scannedAt,
  binNumber: collectionCards.binNumber,
  capturedImagePath: collectionCards.capturedImagePath,
  capturedImageDataUrl: collectionCards.capturedImageDataUrl,
  isFoil: collectionCards.isFoil,
  isDownloaded: collectionCards.isDownloaded,
  alternativeMatches: collectionCards.alternativeMatches,
  variant: collectionCards.variant,
  needsReview: collectionCards.needsReview,
  scanScore: collectionCards.scanScore,
  scanMargin: collectionCards.scanMargin,
  originalCardId: collectionCards.originalCardId,
  originalDistance: collectionCards.originalDistance,
  originalScore: collectionCards.originalScore,
  wasCorrected: collectionCards.wasCorrected,
  reviewVerdict: collectionCards.reviewVerdict,
} as const;

export function toScannedCard(row: {
  guid: string | null;
  card: unknown;
  scannedAt: Date;
  capturedImagePath?: string | null;
  capturedImageDataUrl?: string | null;
  binNumber: number | null;
  isFoil?: boolean | null;
  isDownloaded?: boolean | null;
  alternativeMatches?: unknown;
  variant?: string | null;
  needsReview?: boolean | null;
  scanScore?: number | null;
  scanMargin?: number | null;
  originalCardId?: string | null;
  originalDistance?: number | null;
  originalScore?: number | null;
  wasCorrected?: boolean | null;
  reviewVerdict?: string | null;
}): ScannedCard {
  return {
    scanId: row.guid!,
    card: row.card as PlayingCardWithDistance,
    scannedAt: row.scannedAt.getTime(),
    binNumber: row.binNumber ?? undefined,
    // Prefer the file; fall back to any legacy inline data URL.
    capturedImageUrl:
      captureUrl(row.capturedImagePath) ??
      row.capturedImageDataUrl ??
      undefined,
    isFoil: row.isFoil ?? undefined,
    isDownloaded: row.isDownloaded ?? undefined,
    alternativeMatches:
      (row.alternativeMatches as PlayingCardWithDistance[] | null) ?? undefined,
    variant: row.variant ?? undefined,
    needsReview: row.needsReview ?? undefined,
    score: row.scanScore ?? undefined,
    margin: row.scanMargin ?? undefined,
    originalCardId: row.originalCardId ?? undefined,
    originalDistance: row.originalDistance ?? undefined,
    originalScore: row.originalScore ?? undefined,
    wasCorrected: row.wasCorrected ?? undefined,
    reviewVerdict:
      (row.reviewVerdict as ScannedCard["reviewVerdict"]) ?? undefined,
  };
}
