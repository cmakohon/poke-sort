import { API_BASE, apiGet, apiPost, apiPut } from "@/lib/api/client";
import type {
  CommitScanSessionResponse,
  OpenScanSession,
  Result,
  ScanSession,
  ScannedCard,
} from "@poke-sort/shared";

/**
 * The scan screen's persistence.
 *
 * Scans stage against a session rather than going straight into a collection,
 * so a run can be discarded without polluting the collection. The staging is
 * server-side (not client state) so an interrupted run survives a reload and
 * so review verdicts can reach a card that has not been saved yet.
 */

export interface OpenSessionResult {
  session: ScanSession;
  /** True when a run was already in progress; its target is left alone. */
  wasExisting: boolean;
}

/** The resume payload — null when no run is in progress. */
export async function getOpenScanSession(): Promise<OpenScanSession | null> {
  const result = await apiGet<Result<OpenScanSession | null>>(
    "/api/scan-sessions/open",
  );
  return result.data ?? null;
}

/** Get-or-create. Safe to call on every scan; the server settles the race. */
export async function openScanSession(
  targetCollectionGuid: string,
): Promise<Result<OpenSessionResult>> {
  return apiPost<Result<OpenSessionResult>>("/api/scan-sessions/open", {
    targetCollectionGuid,
  });
}

export async function retargetScanSession(
  guid: string,
  collectionGuid: string,
): Promise<Result<ScanSession>> {
  return apiPut<Result<ScanSession>>(`/api/scan-sessions/${guid}/target`, {
    collectionGuid,
  });
}

export async function addSessionCard(
  guid: string,
  record: ScannedCard,
): Promise<Result<ScannedCard>> {
  const res = await fetch(`${API_BASE}/api/scan-sessions/${guid}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
  // 423 (someone else is scanning) and 409 (the run was closed under us) both
  // carry a body the caller needs in order to roll the optimistic add back.
  if (res.ok || res.status === 423 || res.status === 409) return res.json();
  throw new Error(`API error: ${res.status}`);
}

export async function commitScanSession(
  guid: string,
  collectionGuid: string,
): Promise<Result<CommitScanSessionResponse>> {
  return apiPost<Result<CommitScanSessionResponse>>(
    `/api/scan-sessions/${guid}/commit`,
    { collectionGuid },
  );
}

export async function discardScanSession(
  guid: string,
): Promise<Result<{ discardedCount: number }>> {
  return apiPost<Result<{ discardedCount: number }>>(
    `/api/scan-sessions/${guid}/discard`,
  );
}
