import { authQuery } from "../../db";
import { gundamAdapter } from "../gundam/search";
import { SCRYFALL_DEFAULT_URL, scryfallAdapter } from "../scryfall/search";
import type { CardSearchAdapter } from "./types";

const ADAPTERS_BY_GAME_KEY: Record<string, CardSearchAdapter> = {
  gundam: gundamAdapter,
};

const DEFAULT = { adapter: scryfallAdapter, baseUrl: SCRYFALL_DEFAULT_URL };

export async function resolveCardSearch(
  jwtClaims: string,
  collectionGuid: string | undefined,
): Promise<{ adapter: CardSearchAdapter; baseUrl: string }> {
  if (!collectionGuid) return DEFAULT;

  const game = await authQuery(jwtClaims, async (tx) => {
    const collection = await tx.query.collections.findFirst({
      where: (t, { eq }) => eq(t.guid, collectionGuid),
      columns: { gameId: true },
    });
    if (!collection?.gameId) return null;
    return tx.query.games.findFirst({
      where: (t, { eq }) => eq(t.id, collection.gameId!),
    });
  });

  if (!game) return DEFAULT;

  return {
    adapter: ADAPTERS_BY_GAME_KEY[game.key] ?? scryfallAdapter,
    baseUrl: game.dataSourceUrl || SCRYFALL_DEFAULT_URL,
  };
}
