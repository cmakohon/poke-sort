import type { IdentifySignals, IdentifyTier, OcrReading } from "./api.interface";
import type { PlayingCard } from "./card.interface";

/**
 * Why a prediction was wrong, from the human reviewer's point of view.
 *
 * Multi-select, because the reasons span two independent facets — what was
 * wrong with the input (upside down, glare) and what was wrong with the
 * match (wrong set, wrong type) — and those legitimately co-occur. Each
 * value points threshold/weight tuning somewhere specific:
 * "same-art-different-set" at the set-abbreviation signal, "upside-down"
 * at the flip-retry logic, "ocr-misread" at the collector-number matcher.
 * Free text goes in the note, not here — the enum exists to aggregate.
 *
 * Order matters: the review screen maps these onto hotkeys 1–9.
 */
export const MISMATCH_REASONS = [
  "wrong-card", // wrong pokemon entirely
  "same-pokemon-different-card", // right pokemon, wrong set or printing
  "same-art-different-set", // exact reprint confusion
  "same-card-wrong-type", // same pokemon printed in a different type
  "upside-down",
  "ocr-misread", // name/collector-number read wrong
  "image-quality", // blur / glare / off-center
  "not-a-card", // empty frame, sleeve, junk
  "other",
] as const;
export type MismatchReason = (typeof MISMATCH_REASONS)[number];

/**
 * correct = candidates[0] was right; corrected = a human picked the truth
 * (corrected_card_id on scan_events); unresolvable = a human looked and
 * could not determine the card either.
 */
export type ReviewVerdict = "correct" | "corrected" | "unresolvable";

/** One row of the review queue — scalar fields only, no jsonb blobs. */
export interface ReviewQueueItem {
  guid: string;
  tier: IdentifyTier;
  gameKey: string;
  lang: string;
  collectionGuid: string | null;
  score: number | null;
  margin: number | null;
  /** From candidates->0 — what the pipeline picked, if anything. */
  predictedId: string | null;
  predictedName: string | null;
  /** "se-<guid>.jpeg" under /api/captures, null once pruned. */
  capturePath: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewVerdict: ReviewVerdict | null;
  mismatchReasons: MismatchReason[] | null;
  correctedCardId: string | null;
}

/** A stored candidate, hydrated with catalog data when still resolvable. */
export interface ReviewCandidate {
  id: string;
  name: string | null;
  distance: number;
  score: number;
  signals: IdentifySignals | null;
  /** null when the catalog id no longer hydrates — render name-only. */
  card: PlayingCard | null;
}

export interface ReviewDetail extends ReviewQueueItem {
  ocr: OcrReading | null;
  /** Top candidates by fused score, hydrated server-side. */
  candidates: ReviewCandidate[];
  reviewNote: string | null;
  /** Whether a collection card is linked via scan_event_guid. */
  hasLinkedCard: boolean;
}

export interface ReviewVerdictRequest {
  verdict: ReviewVerdict;
  /** Required when verdict is "corrected". */
  correctedCardId?: string;
  /** At least one required when verdict is "corrected"; optional for "unresolvable". */
  mismatchReasons?: MismatchReason[];
  note?: string;
}

export interface ReviewVerdictResponse {
  guid: string;
  verdict: ReviewVerdict;
  /** True when a linked collection card was updated too. */
  propagated: boolean;
}

export interface ReviewStats {
  unreviewed: Record<IdentifyTier, number>;
  reviewed: number;
}

export interface ReviewQueuePage {
  items: ReviewQueueItem[];
  /** Opaque keyset cursor; null when this is the last page. */
  nextCursor: string | null;
}
