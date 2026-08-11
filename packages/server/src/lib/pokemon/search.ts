import type { PlayingCard, Result } from "@magic-vault/shared";
import { QUERY_MIN_LENGTH } from "@magic-vault/shared";
import type { CardSearchAdapter } from "../card-search/types";
import { getSetInfo, releaseYear } from "../set-index";

export const POKEMON_DEFAULT_URL = "https://api.tcgdex.net/v2/en/cards";

export const POKEMON_HEADERS: Record<string, string> = {
  "User-Agent": "MagicVault/1.0",
  Accept: "application/json",
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

type PokemonVariant =
  | "normal"
  | "reverse"
  | "holo"
  | "firstEdition"
  | "wPromo";

interface PokemonPricing {
  cardmarket?: { avg?: number };
  tcgplayer?: Partial<
    Record<PokemonVariant | "holofoil" | "reverseHolofoil", { marketPrice?: number }>
  >;
}

export interface PokemonCardDetail extends PokemonCardBrief {
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
  weaknesses?: { type?: string; value?: string }[];
  abilities?: PokemonAbility[];
  retreat?: number;
  pricing?: PokemonPricing;
  set?: {
    id: string;
    name: string;
  };
  legal?: {
    standard?: boolean;
  };
}

// TCGdex serves images as a base URL with no extension - the actual asset is
// at `${image}/<quality>.<ext>`. See https://tcgdex.dev/rest/card.
function assetUrl(image: string, quality: "low" | "high"): string {
  return `/api/cards/image-proxy?url=${encodeURIComponent(`${image}/${quality}.webp`)}`;
}

/**
 * TCGplayer keys prices by printing. Preferring `normal` unconditionally meant
 * a reverse holo — often worth several times a normal — was priced as a normal
 * whenever both existed. Prefer the variant actually in hand; only fall back to
 * whatever is available when it is unknown.
 */
const PRICE_KEYS: Record<PokemonVariant, string[]> = {
  normal: ["normal"],
  reverse: ["reverseHolofoil", "reverse"],
  holo: ["holofoil", "holo"],
  firstEdition: ["firstEdition", "holofoil", "normal"],
  wPromo: ["normal"],
};

const FALLBACK_ORDER = [
  "normal",
  "holofoil",
  "holo",
  "reverseHolofoil",
  "reverse",
];

function resolvePrice(
  pricing: PokemonPricing | undefined,
  variant?: PokemonVariant,
): number | null {
  if (!pricing) return null;
  const tcg = pricing.tcgplayer ?? {};
  const order = variant ? [...PRICE_KEYS[variant], ...FALLBACK_ORDER] : FALLBACK_ORDER;

  for (const key of order) {
    const price = tcg[key as keyof typeof tcg]?.marketPrice;
    if (price != null) return price;
  }
  return pricing.cardmarket?.avg ?? null;
}

export function normalizePokemonCard(
  raw: PokemonCardDetail,
  variant?: PokemonVariant,
): PlayingCard {
  const small = raw.image ? assetUrl(raw.image, "low") : "";
  const large = raw.image ? assetUrl(raw.image, "high") : "";
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
  const text =
    [raw.effect, raw.description, abilityText, attackText]
      .filter(Boolean)
      .join("\n\n") || undefined;
  const typeLine =
    [raw.category, raw.stage ?? raw.trainerType ?? raw.energyType]
      .filter(Boolean)
      .join(" - ") ||
    (raw.category ?? "");

  // Enrich the stored/raw set object with its series and release year. The bin
  // rule engine resolves paths against `raw` first, and TCGdex does not put
  // either on the card — so without this, `set.serie.name` and `set.releaseYear`
  // are unreachable from a rule.
  const setInfo = getSetInfo(raw.set?.id);
  const enrichedRaw = {
    ...raw,
    // Weaknesses are [{type, value}]; a rule path cannot reach into an array of
    // objects, so the types are flattened to a plain string array.
    weaknessTypes: (raw.weaknesses ?? [])
      .map((w) => w.type)
      .filter((t): t is string => !!t),
    ...(setInfo
      ? {
          set: {
            ...raw.set,
            serie: { id: setInfo.serieId, name: setInfo.serieName },
            releaseDate: setInfo.releaseDate,
            releaseYear: releaseYear(setInfo),
          },
        }
      : {}),
  };

  return {
    id: raw.id,
    name: raw.name ?? "",
    image: large ? { small: small || large, normal: large } : null,
    set: raw.set?.id ?? "",
    setName: setInfo?.name ?? raw.set?.name ?? raw.set?.id ?? "",
    collectorNumber: raw.localId ?? "",
    rarity: (raw.rarity ?? "").toLowerCase(),
    typeLine,
    text,
    power: undefined,
    toughness: raw.hp != null ? String(raw.hp) : undefined,
    colorIdentity: raw.types ?? [],
    artist: raw.illustrator ?? undefined,
    price: resolvePrice(raw.pricing, variant),
    sourceUrl: `https://tcgdex.dev/cards/${raw.id}`,
    cmc: raw.retreat,
    raw: enrichedRaw,
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
      .map((card) => normalizePokemonCard(card)),
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
