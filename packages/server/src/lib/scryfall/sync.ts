import type { SyncSource, SyncSourceCard } from "../card-search/sync-types";
import { SCRYFALL_DEFAULT_URL, SCRYFALL_HEADERS } from "./search";

type ScryfallBulkCard = {
  id: string;
  name: string;
  printed_name?: string;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCardsByLanguage(
  baseUrl: string,
  addLog: (msg: string) => void,
  lang: string,
  signal?: AbortSignal,
): Promise<SyncSourceCard[]> {
  addLog(`Searching Scryfall for "${lang}" printings...`);

  const all: ScryfallBulkCard[] = [];
  let url: string | undefined =
    `${baseUrl}/search?q=${encodeURIComponent(`lang:${lang}`)}&unique=prints&order=set`;

  while (url) {
    const res = await fetch(url, { headers: SCRYFALL_HEADERS, signal });
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`Scryfall search fetch failed: ${res.status}`);

    const page = (await res.json()) as {
      data: ScryfallBulkCard[];
      has_more: boolean;
      next_page?: string;
    };
    all.push(...page.data);
    addLog(`Fetched ${all.length} cards so far...`);

    url = page.has_more ? page.next_page : undefined;
    if (url) await sleep(100);
  }

  addLog(`Downloaded ${all.length} cards.`);

  return all.map((c) => ({
    id: c.id,
    name: c.printed_name ?? c.name,
    setCode: c.set,
    imageUrl: c.image_uris?.png ?? c.image_uris?.large,
  }));
}

async function fetchCards(
  baseUrl: string,
  addLog: (msg: string) => void,
  lang: string = "en",
  signal?: AbortSignal,
): Promise<SyncSourceCard[]> {
  if (lang !== "en") return fetchCardsByLanguage(baseUrl, addLog, lang, signal);

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

  const artEntry = catalog.data.find((e) => e.type === "unique_artwork");
  if (!artEntry)
    throw new Error("Could not find unique_artwork bulk data entry");

  addLog("Downloading bulk artwork data...");

  const bulkRes = await fetch(artEntry.download_uri, {
    headers: SCRYFALL_HEADERS,
    signal,
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
  languages: ["en", "de"],
  fetchCards,
  fetchOne,
};
