import { authQuery, db } from "../../db";
import { gundamAdapter } from "../gundam/search";
import { SCRYFALL_DEFAULT_URL, scryfallAdapter } from "../scryfall/search";
import type { CardSearchAdapter } from "./types";

const ADAPTERS_BY_GAME_KEY: Record<string, CardSearchAdapter> = {
  gundam: gundamAdapter,
};

const DEFAULT_GAME_KEY = "mtg";

async function findCollectionGame(jwtClaims: string, collectionGuid: string) {
  return authQuery(jwtClaims, async (tx) => {
    const collection = await tx.query.collections.findFirst({
      where: (t, { eq }) => eq(t.guid, collectionGuid),
      columns: { gameId: true },
    });
    if (!collection?.gameId) return null;
    return tx.query.games.findFirst({
      where: (t, { eq }) => eq(t.id, collection.gameId!),
    });
  });
}

export async function resolveGameKey(
  jwtClaims: string,
  collectionGuid: string | undefined,
): Promise<string> {
  if (!collectionGuid) return DEFAULT_GAME_KEY;
  const game = await findCollectionGame(jwtClaims, collectionGuid);
  return game?.key ?? DEFAULT_GAME_KEY;
}

export async function resolveGameDataSourceUrl(
  gameKey: string,
  fallback: string,
): Promise<string> {
  const game = await db.query.games.findFirst({
    where: (t, { eq }) => eq(t.key, gameKey),
    columns: { dataSourceUrl: true },
  });
  return game?.dataSourceUrl || fallback;
}

export async function resolveCardSearch(
  jwtClaims: string,
  collectionGuid: string | undefined,
): Promise<{ adapter: CardSearchAdapter; baseUrl: string }> {
  const game = collectionGuid
    ? await findCollectionGame(jwtClaims, collectionGuid)
    : null;
  const gameKey = game?.key ?? DEFAULT_GAME_KEY;
  const adapter = ADAPTERS_BY_GAME_KEY[gameKey] ?? scryfallAdapter;
  const baseUrl =
    game?.dataSourceUrl ||
    (await resolveGameDataSourceUrl(gameKey, SCRYFALL_DEFAULT_URL));

  return { adapter, baseUrl };
}
