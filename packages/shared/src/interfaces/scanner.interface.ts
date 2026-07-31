import type { ScryfallCardWithDistance } from "./scryfall.interface";

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

// Describes the fixed scan box used in place of per-frame card detection -
// a fraction of the frame's limiting dimension the box covers, plus a
// fractional offset from center. Calibrated per-org to match camera mounting.
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

export interface CardScannerProps {
  onSearchResults?: (matches: ScryfallCardWithDistance[], capturedImageUrl?: string) => void;
  onNoMatch?: () => void;
  onManualAdd?: () => void;
  onError?: (error: string) => void;
  className?: string;
  compact?: boolean;
}

export interface CardMatch {
  id: number;
  scryfallId: string;
  distance: number;
}

export interface ScannedCard {
  scanId: string;
  card: ScryfallCardWithDistance;
  scannedAt: number;
  binNumber?: number;
  capturedImageUrl?: string;
  alternativeMatches?: ScryfallCardWithDistance[];
  isFoil?: boolean;
  isDownloaded?: boolean;
}
