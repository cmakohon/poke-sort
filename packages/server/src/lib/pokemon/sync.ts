import type { SyncSource, SyncSourceCard } from "../card-search/sync-types";
import { POKEMON_DEFAULT_URL, POKEMON_HEADERS } from "./search";

interface PokemonListCard {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

interface PokemonDetailCard extends PokemonListCard {
  set?: { id: string; cardCount?: { official?: number } };
}

/**
 * The list endpoint only returns {id, localId, name, image}; everything the
 * rule engine and re-ranker need lives on the per-card detail. There is no bulk
 * detail endpoint, so this is one request per card — cheap next to downloading
 * and embedding the image, which the sync already does for every card.
 */
async function fetchDetail(
  id: string,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<PokemonDetailCard | null> {
  try {
    const res = await fetch(`${baseUrl}/${id}`, {
      headers: POKEMON_HEADERS,
      signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as PokemonDetailCard;
  } catch {
    // Non-fatal: the card still gets an embedding, just without the extras.
    return null;
  }
}

function extrasFrom(detail: PokemonDetailCard | null) {
  if (!detail) return {};
  return {
    collectorNumber: detail.localId,
    setTotal: detail.set?.cardCount?.official,
    data: detail,
  };
}

const PAGE_LIMIT = 1000;

// TCGdex image fields are a base URL with no extension - append the
// quality/format suffix to get an actual fetchable asset.
function highResUrl(image: string | undefined): string | undefined {
  return image ? `${image}/high.webp` : undefined;
}

async function fetchCards(
  baseUrl: string,
  addLog: (msg: string) => void,
  _lang?: string,
  signal?: AbortSignal,
): Promise<SyncSourceCard[]> {
  addLog("Fetching Pokémon TCG catalog...");

  const all: PokemonListCard[] = [];
  let page = 1;
  for (;;) {
    const url = `${baseUrl}?pagination:page=${page}&pagination:itemsPerPage=${PAGE_LIMIT}`;
    const res = await fetch(url, { headers: POKEMON_HEADERS, signal });
    if (!res.ok)
      throw new Error(`Pokémon card list fetch failed: ${res.status}`);

    const rows = (await res.json()) as PokemonListCard[];
    all.push(...rows);
    addLog(`Fetched ${all.length} cards so far...`);

    if (rows.length < PAGE_LIMIT) break;
    page += 1;
  }

  return all.map((c) => ({
    id: c.id,
    name: c.name,
    setCode: c.id.split("-")[0] ?? "",
    imageUrl: highResUrl(c.image),
  }));
}

async function fetchOne(id: string, baseUrl: string) {
  const raw = await fetchDetail(id, baseUrl);
  if (!raw) return null;

  return {
    name: raw.name,
    setCode: raw.set?.id ?? raw.id.split("-")[0] ?? "",
    imageUrl: highResUrl(raw.image),
    ...extrasFrom(raw),
  };
}

async function fetchExtras(
  card: { id: string },
  baseUrl: string,
  signal?: AbortSignal,
) {
  return extrasFrom(await fetchDetail(card.id, baseUrl, signal));
}

export const pokemonSyncSource: SyncSource = {
  gameKey: "pokemon",
  label: "Pokémon (TCGdex)",
  defaultUrl: POKEMON_DEFAULT_URL,
  fetchHeaders: POKEMON_HEADERS,
  languages: ["en"],
  fetchCards,
  fetchOne,
  fetchExtras,
};
