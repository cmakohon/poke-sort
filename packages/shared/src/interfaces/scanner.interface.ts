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

/**
 * The legacy scan region: a card-aspect rectangle, optionally turned.
 *
 * Superseded by ScanCorners below, but still the fallback for installs that
 * have never opened the corner editor and for calibration files written before
 * it existed. Nothing writes a ScanRegion any more; the client derives corners
 * from one when no corners are stored.
 */
export interface ScanRegion {
  coverage: number; // 0-1
  offsetX: number; // -0.5 to 0.5
  offsetY: number; // -0.5 to 0.5
  /**
   * Degrees the capture window is turned about its own centre, clockwise in
   * frame coordinates. A camera bolted a degree or two off square makes every
   * card come out crooked, which no amount of moving or resizing an
   * axis-aligned box can fix — so the box turns with it.
   */
  rotation: number;
}

export const DEFAULT_SCAN_REGION: ScanRegion = {
  coverage: 0.85,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
};

/**
 * The scan region's four corners, each as a fraction (0-1) of the raw camera
 * frame's width and height.
 *
 * The camera looks at the platform from an angle, so a card's outline in the
 * frame is a trapezoid — a rigid rectangle can never sit on all four edges at
 * once, and whichever compromise the operator picks bleeds either card edge or
 * platform background into every capture. Four free corners can, and
 * extractCardImage undoes the perspective on the way out.
 *
 * The labels are CARD-relative, not frame-relative: topLeft is the corner the
 * operator sees at the top-left of an upright card in the calibration preview.
 * The camera is mounted sideways, so that is not the frame's top-left. Carrying
 * the card's own orientation in the labels is what lets the warp straighten and
 * turn the capture in one step.
 */
export interface ScanCorners {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

export const SCAN_CORNER_KEYS = [
  "topLeft",
  "topRight",
  "bottomRight",
  "bottomLeft",
] as const satisfies readonly (keyof ScanCorners)[];

export type ScanCornerKey = (typeof SCAN_CORNER_KEYS)[number];

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

/**
 * Layout only: the scanner is a preview now, and what it finds goes straight to
 * the engine provider rather than back out through callbacks on this component.
 */
export interface CardScannerProps {
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
