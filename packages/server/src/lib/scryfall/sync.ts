import type { SyncSource, SyncSourceCard } from "../card-search/sync-types";
import { SCRYFALL_DEFAULT_URL, SCRYFALL_HEADERS } from "./search";

type ScryfallBulkCard = {
  id: string;
  name: string;
  printed_name?: string;
  lang: string;
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

async function downloadBulkData(
  baseUrl: string,
  addLog: (msg: string) => void,
  bulkType: string,
  signal?: AbortSignal,
): Promise<ScryfallBulkCard[]> {
  addLog("Fetching Scryfall bulk data catalog...");

  const catalogRes = await fetch(`${apiRoot(baseUrl)}/bulk-data`, {
    headers: SCRYFALL_HEADERS,
    signal,
  });
  if (!catalogRes.ok) {
    throw new Error(`Scryfall catalog fetch failed: ${catalogRes.status}`);
  }
  const catalog = (await catalogRes.json()) as {
    data: { type: string; download_uri: string }[];
  };

  const entry = catalog.data.find((e) => e.type === bulkType);
  if (!entry) throw new Error(`Could not find ${bulkType} bulk data entry`);

  addLog(`Downloading bulk "${bulkType}" data...`);

  const bulkRes = await fetch(entry.download_uri, {
    headers: SCRYFALL_HEADERS,
    signal,
  });
  if (!bulkRes.ok)
    throw new Error(`Bulk data download failed: ${bulkRes.status}`);

  const cards = (await bulkRes.json()) as ScryfallBulkCard[];
  addLog(`Downloaded ${cards.length} cards.`);

  return cards;
}

async function fetchCards(
  baseUrl: string,
  addLog: (msg: string) => void,
  lang: string = "en",
  signal?: AbortSignal,
): Promise<SyncSourceCard[]> {
  const cards =
    lang === "en"
      ? await downloadBulkData(baseUrl, addLog, "unique_artwork", signal)
      : (await downloadBulkData(baseUrl, addLog, "all_cards", signal)).filter(
          (c) => c.lang === lang,
        );

  return cards.map((c) => ({
    id: c.id,
    name: c.printed_name ?? c.name,
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
  languages: ["en", "de"],
  fetchCards,
  fetchOne,
};
