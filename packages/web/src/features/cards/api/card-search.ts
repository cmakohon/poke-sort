import { apiGet } from "@/lib/api/client";
import type { PlayingCard, Result } from "@magic-vault/shared";

export async function searchCards(
  query: string,
  collectionGuid?: string,
): Promise<Result<PlayingCard[]>> {
  const params = new URLSearchParams({ q: query });
  if (collectionGuid) params.set("collectionGuid", collectionGuid);
  return apiGet<Result<PlayingCard[]>>(`/api/cards/search?${params}`);
}

export async function getCardById(
  id: string,
  collectionGuid?: string,
): Promise<Result<PlayingCard>> {
  const params = collectionGuid
    ? `?${new URLSearchParams({ collectionGuid })}`
    : "";
  return apiGet<Result<PlayingCard>>(`/api/cards/search/${id}${params}`);
}
