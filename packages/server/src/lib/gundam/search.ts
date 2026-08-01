import type { PlayingCard, Result } from "@magic-vault/shared";
import { QUERY_MIN_LENGTH } from "@magic-vault/shared";
import type { CardSearchAdapter } from "../card-search/types";

export const GUNDAM_DEFAULT_URL = "https://api.gcgapi.com/v1/cards";

export const GUNDAM_HEADERS: Record<string, string> = {
  "User-Agent": "MagicVault/1.0",
  Accept: "application/json",
  ...(process.env.GCG_API_KEY ? { "X-API-Key": process.env.GCG_API_KEY } : {}),
};

const NOT_LEGAL: PlayingCard["legalities"] = {
  standard: "not_legal",
  future: "not_legal",
  historic: "not_legal",
  timeless: "not_legal",
  gladiator: "not_legal",
  pioneer: "not_legal",
  modern: "not_legal",
  legacy: "not_legal",
  pauper: "not_legal",
  vintage: "not_legal",
  penny: "not_legal",
  commander: "not_legal",
  oathbreaker: "not_legal",
  standardbrawl: "not_legal",
  brawl: "not_legal",
  alchemy: "not_legal",
  paupercommander: "not_legal",
  duel: "not_legal",
  oldschool: "not_legal",
  premodern: "not_legal",
  predh: "not_legal",
};

interface GundamCard {
  product_id: string;
  card_number: string;
  name: string;
  set_code: string;
  set_name: string;
  rarity: string;
  card_type: string;
  color: string | null;
  cost: number | null;
  ap: number | null;
  hp: number | null;
  effect: string;
  image_url: string;
  detail_url: string | null;
  keyword_effects?: { keyword: string; value: number | null }[];
}

function proxiedImageUrl(url: string): string {
  return `/api/cards/image-proxy?url=${encodeURIComponent(url)}`;
}

function normalizeGundamCard(raw: GundamCard): PlayingCard {
  const id = String(raw.product_id ?? raw.card_number ?? "");
  const image = raw.image_url ? proxiedImageUrl(raw.image_url) : "";
  const setCode = raw.set_code ?? "";
  const collectorNumber =
    String(raw.card_number ?? id)
      .split("-")
      .pop() ?? "";
  const colors = raw.color ? [raw.color] : [];
  const keywords = Array.isArray(raw.keyword_effects)
    ? raw.keyword_effects.map((k) => k.keyword).filter(Boolean)
    : [];

  return {
    object: "card",
    id,
    oracle_id: id,
    name: raw.name ?? "",
    lang: "en",
    released_at: "",
    uri: raw.detail_url ?? "",
    scryfall_uri: raw.detail_url ?? "",
    layout: "normal",
    highres_image: true,
    image_status: "highres_scan",
    image_uris: image
      ? {
          small: image,
          normal: image,
          large: image,
          png: image,
          art_crop: image,
          border_crop: image,
        }
      : undefined,
    cmc: typeof raw.cost === "number" ? raw.cost : 0,
    type_line: raw.card_type ?? "",
    oracle_text: raw.effect || undefined,
    power: raw.ap != null ? String(raw.ap) : undefined,
    toughness: raw.hp != null ? String(raw.hp) : undefined,
    colors,
    color_identity: colors,
    keywords,
    legalities: NOT_LEGAL,
    games: [],
    reserved: false,
    game_changer: false,
    foil: false,
    nonfoil: true,
    finishes: ["nonfoil"],
    oversized: false,
    promo: false,
    reprint: false,
    variation: false,
    set_id: setCode,
    set: setCode,
    set_name: raw.set_name || setCode,
    set_type: "expansion",
    set_uri: "",
    set_search_uri: "",
    scryfall_set_uri: "",
    rulings_uri: "",
    prints_search_uri: "",
    collector_number: collectorNumber,
    digital: false,
    rarity: (raw.rarity ?? "").toLowerCase(),
    artist: "",
    artist_ids: [],
    border_color: "black",
    frame: "2015",
    full_art: false,
    textless: false,
    booster: false,
    story_spotlight: false,
    prices: {
      usd: null,
      usd_foil: null,
      usd_etched: null,
      eur: null,
      eur_foil: null,
      tix: null,
    },
  };
}

function extractRows(json: unknown): GundamCard[] {
  if (Array.isArray(json)) return json as GundamCard[];
  if (
    json &&
    typeof json === "object" &&
    Array.isArray((json as { data?: unknown }).data)
  ) {
    return (json as { data: GundamCard[] }).data;
  }
  return [];
}

function extractOne(json: unknown): GundamCard | null {
  if (
    json &&
    typeof json === "object" &&
    "data" in json &&
    (json as { data?: unknown }).data
  ) {
    return (json as { data: GundamCard }).data;
  }
  return (json as GundamCard) ?? null;
}

export async function Search(
  query: string,
  baseUrl: string = GUNDAM_DEFAULT_URL,
): Promise<Result<PlayingCard[]>> {
  if (!query || query.trim().length < QUERY_MIN_LENGTH) {
    return {
      message: `Your query must be greater than ${QUERY_MIN_LENGTH}`,
      success: false,
    };
  }

  const url = `${baseUrl}?name=${encodeURIComponent(query)}&limit=60`;
  const response = await fetch(url, { headers: GUNDAM_HEADERS });

  if (response.status === 404) {
    return {
      message: `No cards were found with the query: ${query}`,
      success: false,
    };
  }

  if (!response.ok) {
    return {
      message: "Failed to fetch from the Gundam Card Game API.",
      success: false,
    };
  }

  const rows = extractRows(await response.json());

  return {
    message: "Cards successfully retrieved.",
    data: rows.map(normalizeGundamCard),
    success: true,
  };
}

export async function SearchById(
  id: string,
  baseUrl: string = GUNDAM_DEFAULT_URL,
): Promise<Result<PlayingCard>> {
  const response = await fetch(`${baseUrl}/${id}`, { headers: GUNDAM_HEADERS });

  if (!response.ok) {
    return {
      success: false,
      message: `Gundam Card Game API error: ${response.status} for card ${id}`,
    };
  }

  const raw = extractOne(await response.json());
  if (!raw) {
    return { success: false, message: `Card ${id} not found.` };
  }

  return {
    success: true,
    message: "Successfully fetched card by id.",
    data: normalizeGundamCard(raw),
  };
}

export const gundamAdapter: CardSearchAdapter = {
  defaultUrl: GUNDAM_DEFAULT_URL,
  search: Search,
  searchById: SearchById,
};
