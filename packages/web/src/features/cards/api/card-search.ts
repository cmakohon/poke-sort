import { apiGet } from "@/lib/api/client";
import type { Result, ScryfallCard } from "@magic-vault/shared";

export async function searchCards(
  query: string,
  collectionGuid?: string,
): Promise<Result<ScryfallCard[]>> {
  const params = new URLSearchParams({ q: query });
  if (collectionGuid) params.set("collectionGuid", collectionGuid);
  return apiGet<Result<ScryfallCard[]>>(`/api/cards/search?${params}`);
}

export async function getCardById(
  id: string,
  collectionGuid?: string,
): Promise<Result<ScryfallCard>> {
  const params = collectionGuid
    ? `?${new URLSearchParams({ collectionGuid })}`
    : "";
  return apiGet<Result<ScryfallCard>>(`/api/cards/search/${id}${params}`);
}
