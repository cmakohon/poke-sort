import type { SerialRequestResult } from "@/features/scanner/lib/serial-request-queue";
import type {
  PlayingCard,
  PlayingCardWithDistance,
  ReviewCardSync,
  ScanOutcome,
  ScanCorners,
  ScanRegion,
  ScanSession,
  ScannedCard,
  ScannerStatus,
} from "@poke-sort/shared";

export type CameraStatus = "idle" | "requesting" | "ready" | "error";

export interface ZoomRange {
  min: number;
  max: number;
  step: number;
}

export interface CameraContextValue {
  stream: MediaStream | null;
  status: CameraStatus;
  errorMessage: string;
  zoom: number;
  zoomRange: ZoomRange | null;
  cameras: MediaDeviceInfo[];
  selectedCameraId: string | null;
  setZoom: (value: number) => void;
  selectCamera: (deviceId: string) => void;
  retryCamera: () => Promise<void>;
  stopCamera: () => void;
}

export interface ScannedCardsContextValue {
  /**
   * The current run's staged cards — not a collection's contents. Scanning
   * used to write straight into the active collection, which made this list
   * that collection's entire history and left no way to discard a test run.
   */
  cards: ScannedCard[];
  /** The open run, or null when none has started yet. */
  session: ScanSession | null;
  isLoading: boolean;
  autoFeed: boolean;
  /** While on, every scan is saved and priced as a reverse holo. */
  reverseHolo: boolean;
  elapsedMs: number;
  isTimerActive: boolean;
  setAutoFeed: (enabled: boolean) => void;
  setReverseHolo: (enabled: boolean) => void;
  addCard: (
    card: PlayingCardWithDistance,
    capturedImageUrl?: string,
    alternativeMatches?: PlayingCardWithDistance[],
    outcome?: ScanOutcome,
  ) => void;
  sendCatchAllBin: () => void;
  /**
   * Routes a card the app is not recording to the review bin — an unreadable
   * scan. Falls back to the catch-all when no bin is dedicated to review.
   */
  sendReviewBin: () => void;
  registerCardArrivedHook: (fn: () => void) => () => void;
  registerPauseHook: (fn: () => void) => () => void;
  removeCard: (scanId: string) => void;
  removeCards: (scanIds: string[]) => void;
  correctCard: (scanId: string, card: PlayingCard) => void;
  toggleFoil: (scanId: string, isFoil: boolean) => void;
  markDownloaded: (scanIds: string[]) => void;
  /**
   * Commits the run's staged cards into a collection and closes the run.
   * Resolves false when the run is still open, so the caller can keep its
   * dialog up rather than implying the cards were saved.
   */
  saveSession: (collectionGuid: string) => Promise<boolean>;
  /**
   * Throws the run away. The scan_events rows behind these scans survive, so
   * the review screen keeps its training data for a discarded run. Resolves
   * false when the run is still open.
   */
  discardSession: () => Promise<boolean>;
  /** A save or discard is in flight; the session bar disables itself. */
  isClosingSession: boolean;
  /**
   * Patches one card in place after a review-screen verdict propagated to
   * it server-side. The list only refetches on collection switch, so
   * without this the scan screen keeps showing the pre-review card.
   */
  applyReviewSync: (sync: ReviewCardSync) => void;
}

/**
 * The capture half of the sort ring, hoisted above the router.
 *
 * It used to live in the CardScanner route component, which meant navigating
 * off the scan screen unmounted it: the feeder kept advancing cards that
 * nothing captured, and the ring stopped without an error. Everything here is
 * provider-owned so a run survives the operator wandering to /review.
 */
export interface ScannerEngineValue {
  status: ScannerStatus;
  errorMessage: string;
  duplicateCard: PlayingCardWithDistance | null;
  debugImageUrl: string | null;
  allowDuplicates: boolean;
  setAllowDuplicates: (value: boolean) => void;
  isCameraActive: boolean;
  isFeeding: boolean;
  isClearingDevice: boolean;
  /** The always-mounted hidden video both the preview and capture read from. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Raw frame dimensions, known once the stream is playing. */
  videoSize: { width: number; height: number } | null;
  /**
   * Resolved from org settings; the preview overlay outlines what capture
   * warps to. Corners win when present, and the legacy rectangle is the
   * fallback — see resolveCardContour in lib/card-detection.ts.
   */
  scanRegion: ScanRegion;
  scanCorners: ScanCorners | null;
  handleForceScan: () => void;
  handleForceAddDuplicate: () => void;
  handleSkipDuplicate: () => void;
  /** Operator pause — also clears autofeed, unlike the registered pause hook. */
  handlePause: () => void;
  handleResume: () => void;
  handleRetryError: () => Promise<void>;
  handleFeed: () => Promise<void>;
  handleClearDevice: () => Promise<void>;
}

export type SerialMessageListener = (message: unknown) => void;

export interface SerialContextValue {
  isConnected: boolean;
  isReady: boolean;
  /**
   * Bumped on every explicit Disconnect (never on a dropped stream), so
   * consumers can void recovery state a deliberate disconnect invalidates.
   */
  userDisconnectCount: number;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  sendBin: (binNumber: number) => Promise<unknown | null>;
  sendTest: () => Promise<boolean>;
  /**
   * One atomic write-then-read exchange: `data` is a JSON command without
   * trailing newline, the result carries the reply that answered it. Replaces
   * the old sendCommand/receiveResponse pair, which nothing kept paired.
   */
  request: (data: string, timeoutMs?: number) => Promise<SerialRequestResult>;
  /**
   * Same, but queued sends sharing `key` collapse to the latest payload —
   * for sliders, where only the newest value matters.
   */
  requestLatest: (
    key: string,
    data: string,
    timeoutMs?: number,
  ) => Promise<SerialRequestResult>;
  subscribe: (listener: SerialMessageListener) => () => void;
  /** Returns an unregister function — call it in effect cleanup. */
  registerPreTestHook: (fn: () => Promise<void>) => () => void;
}

export interface ScannerControlsProps {
  status: ScannerStatus;
  duplicateCardName?: string;
  onForceAddDuplicate: () => void;
  onForceScan: () => void;
  onSkipDuplicate: () => void;
  onPause: () => void;
  onResume: () => void;
}

export interface ScannerOverlayProps {
  status: ScannerStatus;
  errorMessage: string;
  isCameraActive: boolean;
  isConnected: boolean;
  isReady: boolean;
  hasCatchAll: boolean;
  onRetryError: () => void;
}

export interface SetStats {
  code: string;
  name: string;
  count: number;
  value: number;
  /** Series this set belongs to, injected into the card by the server. */
  serieName?: string;
  /** Proxied set symbol, when the source provides one. */
  symbol?: string | null;
}
