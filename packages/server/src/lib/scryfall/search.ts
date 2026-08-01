import type { PlayingCard, Result } from "@magic-vault/shared";
import { QUERY_MIN_LENGTH } from "@magic-vault/shared";
import type { CardSearchAdapter } from "../card-search/types";

export const SCRYFALL_DEFAULT_URL = "https://api.scryfall.com/cards";

export const SCRYFALL_HEADERS = {
  "User-Agent": "MagicVault/1.0",
  Accept: "application/json",
};

export async function Search(
  query: string,
  baseUrl: string = SCRYFALL_DEFAULT_URL,
): Promise<Result<PlayingCard[]>> {
  if (!query || query.trim().length < QUERY_MIN_LENGTH) {
    return {
      message: `Your query must be greater than ${QUERY_MIN_LENGTH}`,
      success: false,
    };
  }

  const scryfallUrl = `${baseUrl}/search?q=${encodeURIComponent(query)}&unique=prints&order=released&dir=desc`;

  const response = await fetch(scryfallUrl, {
    headers: SCRYFALL_HEADERS,
  });

  if (response.status === 404) {
    return {
      message: `No cards were found with the query: ${query}`,
      success: false,
    };
  }

  if (!response.ok) {
    return {
      message: "Failed to fetch from Scryfall.",
      success: false,
    };
  }

  const data = (await response.json()) as { data: PlayingCard[] };

  return {
    message: "Cards successfully retrieved.",
    data: data.data,
    success: true,
  };
}

export async function SearchById(
  id: string,
  baseUrl: string = SCRYFALL_DEFAULT_URL,
): Promise<Result<PlayingCard>> {
  const response = await fetch(`${baseUrl}/${id}`, {
    headers: SCRYFALL_HEADERS,
  });

  if (!response.ok) {
    return {
      success: false,
      message: `Scryfall API error: ${response.status} for card ${id}`,
    };
  }

  return {
    success: true,
    message: "Successfully fetched card by id.",
    data: await response.json(),
  };
}

export const scryfallAdapter: CardSearchAdapter = {
  defaultUrl: SCRYFALL_DEFAULT_URL,
  search: Search,
  searchById: SearchById,
};
