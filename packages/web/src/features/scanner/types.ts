import type { SerialRequestResult } from "@/features/scanner/lib/serial-request-queue";
import type {
  PlayingCard,
  PlayingCardWithDistance,
  ReviewCardSync,
  ScanOutcome,
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
  elapsedMs: number;
  isTimerActive: boolean;
  setAutoFeed: (enabled: boolean) => void;
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

export type SerialMessageListener = (message: unknown) => void;

export interface SerialContextValue {
  isConnected: boolean;
  isReady: boolean;
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
