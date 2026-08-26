import { apiGet } from "@/lib/api/client";
import type { PlayingCard, Result } from "@poke-sort/shared";

export interface CardSearchSetFacet {
  code: string;
  name: string;
  count: number;
}

export interface CardSearchPage {
  cards: PlayingCard[];
  /** Rows matching the query, across every page — not just the ones returned. */
  total: number;
  page: number;
  limit: number;
  /** Every set in the whole match, so the filter can reach past page one. */
  sets: CardSearchSetFacet[];
}

// gameKey is the fallback the review screen uses: scan_events rows know
// their game but may have been captured with no collection active.
export async function searchCards(
  query: string,
  options: {
    collectionGuid?: string;
    gameKey?: string;
    setCode?: string;
    page?: number;
  } = {},
): Promise<Result<CardSearchPage>> {
  const params = new URLSearchParams({ q: query });
  if (options.collectionGuid) params.set("collectionGuid", options.collectionGuid);
  if (options.gameKey) params.set("gameKey", options.gameKey);
  if (options.setCode) params.set("setCode", options.setCode);
  if (options.page && options.page > 1) params.set("page", String(options.page));
  return apiGet<Result<CardSearchPage>>(`/api/cards/search?${params}`);
}

/**
 * The same query against the game's live API, for the printings the local
 * catalog never imported (the sync drops every card upstream has no image
 * for). Explicit, because it costs one upstream fetch per hit — the picker
 * offers it only once the local search has come back empty.
 */
export async function searchCardsOnline(
  query: string,
  options: { collectionGuid?: string; gameKey?: string } = {},
): Promise<Result<PlayingCard[]>> {
  const params = new URLSearchParams({ q: query });
  if (options.collectionGuid) params.set("collectionGuid", options.collectionGuid);
  if (options.gameKey) params.set("gameKey", options.gameKey);
  return apiGet<Result<PlayingCard[]>>(`/api/cards/search/online?${params}`);
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
