import type { CardPricing, PlayingCard, Result } from "@poke-sort/shared";
import { resolveMarketPrice } from "@poke-sort/shared";
import type { CardSearchAdapter } from "../card-search/types";
import { getSetInfo, releaseYear } from "../set-index";

export const POKEMON_DEFAULT_URL = "https://api.tcgdex.net/v2/en/cards";

export const POKEMON_HEADERS: Record<string, string> = {
  "User-Agent": "PokeSort/1.0",
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
  pricing?: CardPricing;
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
 * The one number bin rules route on.
 *
 * Which printing it comes from is decided by resolveMarketPrice in shared, so
 * the detail panel can label the number without re-deriving the choice and
 * drifting from it.
 *
 * cardmarket.avg stays the last resort: a few cards carry it and nothing else.
 */
function resolvePrice(
  pricing: CardPricing | undefined,
  variant?: PokemonVariant,
): number | null {
  return resolveMarketPrice(pricing, variant) ?? pricing?.cardmarket?.avg ?? null;
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
    hp: raw.hp != null ? String(raw.hp) : undefined,
    types: raw.types ?? [],
    artist: raw.illustrator ?? undefined,
    price: resolvePrice(raw.pricing, variant),
    pricing: raw.pricing,
    sourceUrl: `https://tcgdex.dev/cards/${raw.id}`,
    retreatCost: raw.retreat,
    raw: enrichedRaw,
  };
}

/**
 * Every outbound request gets a deadline.
 *
 * These run inside a scan: the price refresh is awaited before the bin decision
 * is made, and Node's fetch has no default timeout, so a hung connection would
 * otherwise hold a socket open indefinitely with nothing to end it. The caller
 * stops waiting after PRICE_TIMEOUT_MS regardless — this is what stops the
 * abandoned request from outliving it.
 */
const REQUEST_TIMEOUT_MS = 10_000;

async function fetchDetail(
  id: string,
  baseUrl: string,
): Promise<PokemonCardDetail | null> {
  const response = await fetch(`${baseUrl}/${id}`, {
    headers: POKEMON_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return (await response.json()) as PokemonCardDetail;
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
  searchById: SearchById,
};
