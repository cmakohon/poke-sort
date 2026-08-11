import { useBinConfigs } from "@/features/bins/api/use-bin-configs";
import { useGameFacets, type GameFacets } from "@/features/bins/api/use-facets";
import type {
  PickerGroup,
  PickerOption,
} from "@/features/bins/components/option-picker";
import type { FieldMeta } from "@poke-sort/shared";

/**
 * Resolves the choices for a field, preferring what the catalog actually
 * contains over a list frozen at seed time.
 *
 * Falls back to the static `options` whenever facets are unavailable — an empty
 * catalog, a failed request, or a game with no facet support — so the rule
 * builder is never left with nothing to pick from.
 */
export function useFieldOptions(fieldMeta: FieldMeta | undefined): {
  options?: PickerOption[];
  groups?: PickerGroup[];
  searchable: boolean;
  isLoading: boolean;
} {
  const { gameKey, lang } = useBinConfigs();
  const wantsFacets = fieldMeta?.optionsSource === "facet";
  const { data: facets, isLoading } = useGameFacets(
    wantsFacets ? gameKey : undefined,
    lang,
  );

  const staticOptions = fieldMeta?.options?.map((o) => ({ ...o }));

  if (!fieldMeta || !wantsFacets) {
    return { options: staticOptions, searchable: false, isLoading: false };
  }

  const key = fieldMeta.facetKey ?? fieldMeta.field;

  // Sets are the one grouped picker: a flat list of 218 is unusable, and
  // "everything in this series" is a rule people genuinely want.
  if (key === "sets") {
    const groups: PickerGroup[] = (facets?.series ?? []).map((serie) => ({
      key: serie.value,
      label: `${serie.label} (${serie.count})`,
      options: serie.sets.map((set) => ({
        value: set.value,
        label: set.releaseYear ? `${set.label} · ${set.releaseYear}` : set.label,
        count: set.count,
        icon: set.symbol,
      })),
    }));
    return {
      groups: groups.length > 0 ? groups : undefined,
      options: groups.length > 0 ? undefined : staticOptions,
      searchable: true,
      isLoading,
    };
  }

  if (key === "series") {
    const options = (facets?.series ?? []).map((serie) => ({
      value: serie.label,
      label: serie.label,
      count: serie.count,
      icon: serie.logo,
    }));
    return {
      options: options.length > 0 ? options : staticOptions,
      searchable: options.length > 12,
      isLoading,
    };
  }

  const list = facets?.[key as keyof GameFacets];
  const options = Array.isArray(list)
    ? (list as { value: string; label: string; count: number }[]).map((v) => ({
        value: v.value,
        label: v.label,
        count: v.count,
      }))
    : undefined;

  return {
    options: options?.length ? options : staticOptions,
    // Long vocabularies (illustrators run into four figures) need a search box.
    searchable: (options?.length ?? 0) > 12,
    isLoading,
  };
}
