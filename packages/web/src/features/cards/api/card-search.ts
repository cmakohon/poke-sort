import { apiGet } from "@/lib/api/client";
import type { PlayingCard, Result } from "@poke-sort/shared";

// gameKey is the fallback the review screen uses: scan_events rows know
// their game but may have been captured with no collection active.
export async function searchCards(
  query: string,
  collectionGuid?: string,
  gameKey?: string,
): Promise<Result<PlayingCard[]>> {
  const params = new URLSearchParams({ q: query });
  if (collectionGuid) params.set("collectionGuid", collectionGuid);
  if (gameKey) params.set("gameKey", gameKey);
  return apiGet<Result<PlayingCard[]>>(`/api/cards/search?${params}`);
}

export async function getCardById(
  id: string,
  collectionGuid?: string,
  gameKey?: string,
): Promise<Result<PlayingCard>> {
  const params = new URLSearchParams();
  if (collectionGuid) params.set("collectionGuid", collectionGuid);
  if (gameKey) params.set("gameKey", gameKey);
  const suffix = params.size > 0 ? `?${params}` : "";
  return apiGet<Result<PlayingCard>>(`/api/cards/search/${id}${suffix}`);
}
