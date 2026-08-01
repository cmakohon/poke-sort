import type { PlayingCard, Result } from "@magic-vault/shared";
import { QUERY_MIN_LENGTH } from "@magic-vault/shared";
import type { CardSearchAdapter } from "../card-search/types";

export const POKEMON_DEFAULT_URL = "https://api.tcgdex.net/v2/en/cards";

export const POKEMON_HEADERS: Record<string, string> = {
  "User-Agent": "MagicVault/1.0",
  Accept: "application/json",
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

interface PokemonCardBrief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

interface PokemonAttack {
  name: string;
  cost?: string[];
  damage?: string | number;
  effect?: string;
}

interface PokemonAbility {
  type?: string;
  name: string;
  effect?: string;
}

interface PokemonWeakResist {
  type: string;
  value: string;
}

interface PokemonCardDetail extends PokemonCardBrief {
  category?: string;
  illustrator?: string;
  rarity?: string;
  hp?: number;
  types?: string[];
  evolveFrom?: string;
  description?: string;
  stage?: string;
  trainerType?: string;
  energyType?: string;
  effect?: string;
  attacks?: PokemonAttack[];
  abilities?: PokemonAbility[];
  weaknesses?: PokemonWeakResist[];
  resistances?: PokemonWeakResist[];
  retreat?: number;
  set?: {
    id: string;
    name: string;
    releaseDate?: string;
  };
  legal?: {
    standard?: boolean;
    expanded?: boolean;
  };
}

// TCGdex serves images as a base URL with no extension - the actual asset is
// at `${image}/<quality>.<ext>`. See https://tcgdex.dev/rest/card.
function assetUrl(image: string, quality: "low" | "high"): string {
  return `/api/cards/image-proxy?url=${encodeURIComponent(`${image}/${quality}.webp`)}`;
}

function normalizePokemonCard(raw: PokemonCardDetail): PlayingCard {
  const small = raw.image ? assetUrl(raw.image, "low") : "";
  const large = raw.image ? assetUrl(raw.image, "high") : "";
  const colors = raw.types ?? [];
  const attackText = (raw.attacks ?? [])
    .map((a) =>
      [a.name, a.damage != null ? `(${a.damage})` : "", a.effect]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");
  const abilityText = (raw.abilities ?? [])
    .map((a) => [a.name, a.effect].filter(Boolean).join(": "))
    .join("\n");
  const oracleText =
    [raw.effect, raw.description, abilityText, attackText]
      .filter(Boolean)
      .join("\n\n") || undefined;
  const typeLine =
    [raw.category, raw.stage ?? raw.trainerType ?? raw.energyType]
      .filter(Boolean)
      .join(" - ") ||
    (raw.category ?? "");

  return {
    object: "card",
    id: raw.id,
    oracle_id: raw.id,
    name: raw.name ?? "",
    lang: "en",
    released_at: raw.set?.releaseDate ?? "",
    uri: "",
    scryfall_uri: `https://tcgdex.dev/cards/${raw.id}`,
    layout: "normal",
    highres_image: true,
    image_status: "highres_scan",
    image_uris: large
      ? {
          small: small || large,
          normal: large,
          large,
          png: large,
          art_crop: large,
          border_crop: large,
        }
      : undefined,
    cmc: raw.retreat ?? 0,
    type_line: typeLine,
    oracle_text: oracleText,
    power: undefined,
    toughness: raw.hp != null ? String(raw.hp) : undefined,
    colors,
    color_identity: colors,
    keywords: (raw.abilities ?? []).map((a) => a.name),
    legalities: {
      ...NOT_LEGAL,
      standard: raw.legal?.standard ? "legal" : "not_legal",
    },
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
    set_id: raw.set?.id ?? "",
    set: raw.set?.id ?? "",
    set_name: raw.set?.name || (raw.set?.id ?? ""),
    set_type: "expansion",
    set_uri: "",
    set_search_uri: "",
    scryfall_set_uri: "",
    rulings_uri: "",
    prints_search_uri: "",
    collector_number: raw.localId ?? "",
    digital: false,
    rarity: (raw.rarity ?? "").toLowerCase(),
    artist: raw.illustrator ?? "",
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

async function fetchDetail(
  id: string,
  baseUrl: string,
): Promise<PokemonCardDetail | null> {
  const response = await fetch(`${baseUrl}/${id}`, {
    headers: POKEMON_HEADERS,
  });
  if (!response.ok) return null;
  return (await response.json()) as PokemonCardDetail;
}

// Cap on how many brief search hits get enriched with a full detail fetch.
// TCGdex's list endpoint only returns {id, localId, name, image} - the picker
// UI needs set/rarity/collector number too, so each result needs its own
// /cards/:id call. Keeping this modest bounds the fan-out on every keystroke.
const MAX_ENRICHED_RESULTS = 30;

export async function Search(
  query: string,
  baseUrl: string = POKEMON_DEFAULT_URL,
): Promise<Result<PlayingCard[]>> {
  if (!query || query.trim().length < QUERY_MIN_LENGTH) {
    return {
      message: `Your query must be greater than ${QUERY_MIN_LENGTH}`,
      success: false,
    };
  }

  const url = `${baseUrl}?name=${encodeURIComponent(query)}&pagination:itemsPerPage=${MAX_ENRICHED_RESULTS}`;
  const response = await fetch(url, { headers: POKEMON_HEADERS });

  if (!response.ok) {
    return {
      message: "Failed to fetch from the TCGdex Pokémon API.",
      success: false,
    };
  }

  const briefs = (await response.json()) as PokemonCardBrief[];
  if (briefs.length === 0) {
    return {
      message: `No cards were found with the query: ${query}`,
      success: false,
    };
  }

  const details = await Promise.all(
    briefs.map((b) => fetchDetail(b.id, baseUrl)),
  );

  return {
    message: "Cards successfully retrieved.",
    data: details
      .filter((d): d is PokemonCardDetail => d !== null)
      .map(normalizePokemonCard),
    success: true,
  };
}

export async function SearchById(
  id: string,
  baseUrl: string = POKEMON_DEFAULT_URL,
): Promise<Result<PlayingCard>> {
  const raw = await fetchDetail(id, baseUrl);
  if (!raw) {
    return {
      success: false,
      message: `TCGdex API error: card ${id} not found.`,
    };
  }

  return {
    success: true,
    message: "Successfully fetched card by id.",
    data: normalizePokemonCard(raw),
  };
}

export const pokemonAdapter: CardSearchAdapter = {
  defaultUrl: POKEMON_DEFAULT_URL,
  search: Search,
  searchById: SearchById,
};
