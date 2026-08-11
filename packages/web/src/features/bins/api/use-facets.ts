import { apiGet } from "@/lib/api/client";
import type { Result } from "@magic-vault/shared";
import { useQuery } from "@tanstack/react-query";

/**
 * Which values actually exist in the local catalog.
 *
 * Fixed option lists cannot cover sets — there are 218 and more every quarter —
 * so fields marked `optionsSource: "facet"` load their choices from here
 * instead. Cached hard: the catalog only changes on a sync or a pack import.
 */

export interface FacetValue {
  value: string;
  label: string;
  count: number;
}

export interface SetFacet extends FacetValue {
  serieId: string;
  serieName: string;
  symbol: string | null;
  releaseYear: number | null;
}

export interface SeriesFacet extends FacetValue {
  logo: string | null;
  sets: SetFacet[];
}

export interface GameFacets {
  gameKey: string;
  lang: string;
  totalCards: number;
  series: SeriesFacet[];
  rarity: FacetValue[];
  types: FacetValue[];
  category: FacetValue[];
  stage: FacetValue[];
  trainerType: FacetValue[];
  weakness: FacetValue[];
  illustrator: FacetValue[];
  regulationMark: FacetValue[];
  computedAt: string;
}

export async function getGameFacets(
  gameKey: string,
  lang: string,
): Promise<GameFacets | undefined> {
  const result = await apiGet<Result<GameFacets>>(
    `/api/games/${encodeURIComponent(gameKey)}/facets?lang=${encodeURIComponent(lang)}`,
  );
  return result.data;
}

export function useGameFacets(gameKey: string | undefined, lang: string) {
  return useQuery({
    queryKey: ["game-facets", gameKey, lang],
    queryFn: () => getGameFacets(gameKey!, lang),
    enabled: !!gameKey,
    staleTime: Infinity,
  });
}
