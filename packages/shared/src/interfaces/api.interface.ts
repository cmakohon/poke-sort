import type { PlayingCard } from "./card.interface";

/**
 * What the identify endpoint decided to do with a scan.
 *
 * The previous behaviour was binary — a match or nothing — and the client took
 * `data[0]` unconditionally. "review" exists because physically setting aside
 * an uncertain card is strictly better than confidently sorting it into the
 * wrong bin, which is silent and only discovered much later.
 */
export type IdentifyTier = "accept" | "review" | "no-match";

/** Text read off the captured image, used to disambiguate look-alike cards. */
export interface OcrReading {
  name?: string;
  collectorNumber?: string;
  setTotal?: number;
  hp?: number;
  /**
   * Raw text from the collector-number region, kept alongside the parse.
   *
   * OCR routinely picks up stray marks around the number — "4/102" comes back
   * as "994/102" — which makes an exact parse comparison fail even though the
   * true number is plainly in there. Candidates are matched against this text
   * directly, which turns a hard OCR problem into an easy matching one.
   */
  collectorNumberRaw?: string;
}

/** Per-signal contributions, kept for debugging and the eval harness. */
export interface IdentifySignals {
  embedding: number;
  name: number;
  collectorNumber: number;
  /**
   * The set's printed abbreviation ("OBF", "SSH") found in the bottom band.
   * Independent of the collector number and decisive between reprints, which
   * share art and a name but never a set.
   */
  setAbbreviation: number;
  /**
   * The printed denominator alone ("/123") agreeing with the candidate's set
   * size, independent of whether the numerator was read.
   *
   * Separate from collectorNumber because the two fail differently: the
   * numerator is a small target that OCR garbles constantly, while the
   * denominator is the same digits on every card of a set and survives more
   * often. A denominator narrows ~150 sets to one or two, which is most of the
   * way to splitting a reprint pair.
   */
  setTotal: number;
  hp: number;
}

export interface IdentifyCandidate {
  id: string;
  /** Raw cosine distance from the image embedding. Lower is better. */
  distance: number;
  /** Fused score in 0..1. Higher is better. Equals the embedding term alone
   *  for games without an identity profile. */
  score: number;
  signals?: IdentifySignals;
  /** Hydrated on the server from the stored card data; null if unavailable. */
  card: PlayingCard | null;
}

export interface IdentifyResult {
  tier: IdentifyTier;
  /** Fused score of #1 minus #2; null with fewer than two candidates. Used by
   *  the accept gate — a high score with a close runner-up is not confident. */
  margin: number | null;
  candidates: IdentifyCandidate[];
  ocr?: OcrReading;
  /** 1st Edition stamp reading for the winner, when its card has that variant. */
  stamp?: { stamped: boolean; depth: number; darkFrac: number; spread: number };
  /**
   * True when the winning pass ran on the 180°-rotated capture — the card was
   * fed upside down relative to the camera. With orientation memory this does
   * not imply a retry was paid; duration_ms carries the retry cost.
   */
  flippedRetry?: boolean;
  /**
   * guid of the scan_events diagnostics row recorded for this attempt. The
   * client echoes it back when saving the card so a later correction can be
   * joined to the full diagnostics.
   */
  scanEventId?: string;
}

export interface CardListResponse {
  data: PlayingCard[];
  has_more: boolean;
  next_page?: string;
}

export type SyncStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface SyncState {
  status: SyncStatus;
  gameKey: string;
  lang: string;
  total: number;
  processed: number;
  skipped: number;
  errors: number;
  startedAt: string | null;
  logs: string[];
  currentCard?: string;
}
