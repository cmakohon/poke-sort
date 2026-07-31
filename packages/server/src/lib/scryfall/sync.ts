import type { SyncSource, SyncSourceCard } from "../card-search/sync-types";
import { SCRYFALL_DEFAULT_URL, SCRYFALL_HEADERS } from "./search";

type ScryfallBulkCard = {
  id: string;
  name: string;
  set: string;
  image_uris?: { png?: string; large?: string };
};

function apiRoot(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return new URL(SCRYFALL_DEFAULT_URL).origin;
  }
}

async function fetchCards(
  baseUrl: string,
  addLog: (msg: string) => void,
): Promise<SyncSourceCard[]> {
  addLog("Fetching Scryfall bulk data catalog...");

  const catalogRes = await fetch(`${apiRoot(baseUrl)}/bulk-data`, {
    headers: SCRYFALL_HEADERS,
  });
  if (!catalogRes.ok) {
    throw new Error(`Scryfall catalog fetch failed: ${catalogRes.status}`);
  }
  const catalog = (await catalogRes.json()) as {
    data: { type: string; download_uri: string }[];
  };

  const artEntry = catalog.data.find((e) => e.type === "unique_artwork");
  if (!artEntry)
    throw new Error("Could not find unique_artwork bulk data entry");

  addLog("Downloading bulk artwork data...");

  const bulkRes = await fetch(artEntry.download_uri, {
    headers: SCRYFALL_HEADERS,
  });
  if (!bulkRes.ok)
    throw new Error(`Bulk data download failed: ${bulkRes.status}`);

  const cards = (await bulkRes.json()) as ScryfallBulkCard[];
  addLog(`Downloaded ${cards.length} cards.`);

  return cards.map((c) => ({
    id: c.id,
    name: c.name,
    setCode: c.set,
    imageUrl: c.image_uris?.png ?? c.image_uris?.large,
  }));
}

async function fetchOne(id: string, baseUrl: string) {
  const res = await fetch(`${baseUrl}/${id}`, { headers: SCRYFALL_HEADERS });
  if (!res.ok) return null;
  const card = (await res.json()) as {
    name: string;
    set: string;
    image_uris?: { png?: string; large?: string };
  };
  return {
    name: card.name,
    setCode: card.set,
    imageUrl: card.image_uris?.png ?? card.image_uris?.large,
  };
}

export const scryfallSyncSource: SyncSource = {
  gameKey: "mtg",
  label: "Magic: The Gathering (Scryfall)",
  defaultUrl: SCRYFALL_DEFAULT_URL,
  fetchHeaders: SCRYFALL_HEADERS,
  fetchCards,
  fetchOne,
};
