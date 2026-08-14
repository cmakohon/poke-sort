import type { IdentifyTier } from "./api.interface";
import type { PlayingCardWithDistance } from "./card.interface";

export interface Point {
  x: number;
  y: number;
}

export interface CardContour {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

export interface ScanRegion {
  coverage: number; // 0-1
  offsetX: number; // -0.5 to 0.5
  offsetY: number; // -0.5 to 0.5
}

export const DEFAULT_SCAN_REGION: ScanRegion = {
  coverage: 0.85,
  offsetX: 0,
  offsetY: 0,
};

export interface DetectionResult {
  detected: boolean;
  contour: CardContour | null;
  confidence: number;
}

export type ScannerStatus =
  | "initializing"
  | "requesting-camera"
  | "scanning"
  | "paused"
  | "captured"
  | "duplicate"
  | "no-match"
  | "searching"
  | "error";

/** How confident the pipeline was, carried alongside the matches. */
export interface ScanOutcome {
  tier: IdentifyTier;
  score?: number;
  margin?: number;
  /** guid of the server-side scan_events diagnostics row for this attempt. */
  scanEventId?: string;
}

export interface CardScannerProps {
  onSearchResults?: (
    matches: PlayingCardWithDistance[],
    capturedImageUrl?: string,
    outcome?: ScanOutcome,
  ) => void;
  onNoMatch?: () => void;
  onManualAdd?: () => void;
  onError?: (error: string) => void;
  className?: string;
  compact?: boolean;
}

export interface CardMatch {
  id: number;
  cardId: string;
  distance: number;
}

export interface ScannedCard {
  scanId: string;
  card: PlayingCardWithDistance;
  scannedAt: number;
  binNumber?: number;
  capturedImageUrl?: string;
  alternativeMatches?: PlayingCardWithDistance[];
  isFoil?: boolean;
  isDownloaded?: boolean;
  /** Which printing — normal / reverse / holo / firstEdition. */
  variant?: string;
  /** Fused identification score, when a per-game profile scored this scan. */
  score?: number;
  /** Fused score gap between the top two candidates at scan time. */
  margin?: number;
  /** The pipeline was not confident enough to sort this automatically. */
  needsReview?: boolean;
  /**
   * What the pipeline originally decided, preserved across a human correction.
   * Every correction is a labelled example; overwriting the row threw that away.
   */
  originalCardId?: string;
  originalDistance?: number;
  originalScore?: number;
  wasCorrected?: boolean;
  /** Human verdict from the review screen; undefined = never reviewed. */
  reviewVerdict?: "correct" | "corrected" | "unresolvable";
  /** guid of the scan_events diagnostics row behind this scan. */
  scanEventId?: string;
}
