import { API_BASE, apiDelete, apiGet, apiPost } from "@/lib/api/client";
import type { Result, SyncState } from "@poke-sort/shared";

export interface AdminCard {
  id: number;
  cardId: string;
  gameKey: string;
  lang: string;
  name: string;
  setCode: string;
  updatedAt: string;
}

export interface AdminCardsPage {
  cards: AdminCard[];
  total: number;
  page: number;
  limit: number;
}

export interface SyncSourceInfo {
  gameKey: string;
  label: string;
  languages: string[];
}

export async function listSyncSources(): Promise<{
  success: boolean;
  data: SyncSourceInfo[];
}> {
  return apiGet<{ success: boolean; data: SyncSourceInfo[] }>("/api/admin/sync/sources");
}

export async function startSync(gameKey: string, lang: string = "en"): Promise<{
  success: boolean;
  data: SyncState;
}> {
  return apiPost<{ success: boolean; data: SyncState }>("/api/admin/sync", {
    gameKey,
    lang,
  });
}

export async function cancelSync(): Promise<{
  success: boolean;
  data: SyncState;
}> {
  return apiDelete<{ success: boolean; data: SyncState }>("/api/admin/sync");
}

export async function getSyncStatus(): Promise<{
  success: boolean;
  data: SyncState;
}> {
  return apiGet<{ success: boolean; data: SyncState }>("/api/admin/sync");
}

export interface CardGameCount {
  gameKey: string;
  count: number;
}

export async function listCardGameKeys(): Promise<{
  success: boolean;
  data: CardGameCount[];
}> {
  return apiGet<{ success: boolean; data: CardGameCount[] }>(
    "/api/admin/cards/games",
  );
}

export async function dumpCards(
  gameKey?: string,
): Promise<{ success: boolean; message: string }> {
  return apiPost<{ success: boolean; message: string }>(
    "/api/admin/cards/dump",
    gameKey ? { gameKey } : undefined,
  );
}

export async function listCards(
  page: number,
  search: string,
): Promise<{ success: boolean; data: AdminCardsPage }> {
  const params = new URLSearchParams({ page: String(page), limit: "50" });
  if (search) params.set("search", search);
  return apiGet<{ success: boolean; data: AdminCardsPage }>(`/api/admin/cards?${params}`);
}

export async function revectorizeCard(
  cardId: string,
): Promise<{ success: boolean; message: string }> {
  return apiPost<{ success: boolean; message: string }>(
    `/api/admin/cards/${encodeURIComponent(cardId)}/revectorize`,
  );
}

export async function syncCardById(
  gameKey: string,
  cardId: string,
  lang: string = "en",
): Promise<{ success: boolean; message: string }> {
  return apiPost<{ success: boolean; message: string }>("/api/admin/cards/sync", {
    gameKey,
    cardId,
    lang,
  });
}

export async function createSyncEventSource(): Promise<EventSource> {
  return new EventSource(`${API_BASE}/api/admin/sync/stream`);
}

export interface CatalogStatus {
  gameKey: string;
  lang: string;
  count: number;
  packUrl: string;
}

export type PackJobPhase =
  | "idle"
  | "downloading"
  | "importing"
  | "completed"
  | "failed";

export interface PackJobState {
  phase: PackJobPhase;
  url: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  imported: number;
  cards: number;
  message: string | null;
  startedAt: string | null;
}

/** How many cards are embedded for a game — zero means nothing can be scanned. */
export async function getCatalogStatus(
  gameKey: string,
  lang = "en",
): Promise<CatalogStatus | undefined> {
  const result = await apiGet<Result<CatalogStatus>>(
    `/api/admin/catalog/${encodeURIComponent(gameKey)}?lang=${encodeURIComponent(lang)}`,
  );
  return result.data;
}

/** Kicks off a pack download + import; poll getCatalogImportState for progress. */
export async function startCatalogImport(
  gameKey: string,
  lang = "en",
  url?: string,
): Promise<Result<PackJobState>> {
  return apiPost<Result<PackJobState>>("/api/admin/catalog/import", {
    gameKey,
    lang,
    url,
  });
}

export async function getCatalogImportState(): Promise<
  PackJobState | undefined
> {
  const result = await apiGet<Result<PackJobState>>("/api/admin/catalog/import");
  return result.data;
}
