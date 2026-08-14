import type { ScannedCard } from "./scanner.interface";

/**
 * A scan session — one run of the machine.
 *
 * Scanning used to insert straight into the active collection, so the scan
 * screen showed that collection's whole history and a throwaway test run
 * permanently polluted it. Cards now stage against a session
 * (collection_cards.collection_id NULL, session_guid set) and only acquire a
 * collection when the user saves. Discarding deletes the staged rows;
 * scan_events — the diagnostics and review data — live in their own table and
 * survive untouched, which is the point of staging rather than buffering
 * client-side.
 *
 * At most one session is open per org at a time, enforced by a partial unique
 * index. It is resumed on load, so an interrupted run is not lost.
 */
export type ScanSessionOutcome = "saved" | "discarded";

export interface ScanSession {
  guid: string;
  /**
   * The collection the run is aimed at. It supplies the game key and language
   * to the identify pipeline and the bin rules before a single card is staged
   * — nothing is written to it until commit. Null when the target was deleted
   * mid-run, which leaves the session open but unable to scan.
   */
  targetCollectionGuid: string | null;
  targetCollectionName: string | null;
  /**
   * What the staged cards were actually read against, frozen at the first
   * staged card. The target is not a substitute: switching collections mid-run
   * re-points it, so by save time it can name a different game than the one
   * the cards came from. Null until the run has staged something.
   */
  identifiedGameKey: string | null;
  identifiedLang: string | null;
  startedAt: string;
  closedAt: string | null;
  outcome: ScanSessionOutcome | null;
}

/** GET /api/scan-sessions/open — the resume payload. */
export interface OpenScanSession {
  session: ScanSession;
  cards: ScannedCard[];
}

export interface CommitScanSessionResponse {
  /** Where the cards landed — not necessarily the session's target. */
  collectionGuid: string;
  movedCount: number;
}
