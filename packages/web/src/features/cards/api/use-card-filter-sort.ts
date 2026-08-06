import { getByPath, type FieldMeta, type ScannedCard } from "@magic-vault/shared";
import { useEffect, useMemo, useState } from "react";
import type { CardFilters } from "@/features/cards/types";

const EMPTY_FILTERS: CardFilters = {
  colors: [],
  rarities: [],
  bins: [],
  needsAttention: false,
  showDownloaded: false,
  sets: [],
  minMatchPercent: 0,
};

// Fields sortable on the card grid - multi-value ("set") fields don't have
// a natural sort order, so they're left out.
const SORTABLE_TYPES: FieldMeta["type"][] = ["string", "numeric", "enum"];

function splitSortKey(sortKey: string): { field: string; dir: "asc" | "desc" } {
  const i = sortKey.lastIndexOf("-");
  return { field: sortKey.slice(0, i), dir: sortKey.slice(i + 1) as "asc" | "desc" };
}

// Per-game field definitions (see Game.fieldDefinitions) drive both what's
// sortable and how - "enum" fields (e.g. rarity) are ordered by their
// position in `options`, since that's the only place a game defines a
// meaningful order for its own enum values (there's no universal rarity
// scale across games).
function compareByField(a: ScannedCard, b: ScannedCard, meta: FieldMeta): number {
  const va = getByPath(a.card, meta.path);
  const vb = getByPath(b.card, meta.path);

  if (meta.type === "numeric") {
    const na = typeof va === "number" ? va : Number.parseFloat(String(va ?? "")) || 0;
    const nb = typeof vb === "number" ? vb : Number.parseFloat(String(vb ?? "")) || 0;
    return na - nb;
  }

  if (meta.type === "enum" && meta.options) {
    const order = meta.options.map((o) => o.value);
    const ia = order.indexOf(String(va));
    const ib = order.indexOf(String(vb));
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
  }

  return String(va ?? "").localeCompare(String(vb ?? ""));
}

export function useCardFilterSort(
  cards: ScannedCard[],
  fieldDefinitions: FieldMeta[],
  external?: { filters: CardFilters; setFilters: (filters: CardFilters) => void },
) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>("scan-desc");
  const [internalFilters, setInternalFilters] = useState<CardFilters>(EMPTY_FILTERS);
  const filters = external?.filters ?? internalFilters;
  const setFilters = external?.setFilters ?? setInternalFilters;

  const sortableFields = useMemo(
    () => fieldDefinitions.filter((f) => SORTABLE_TYPES.includes(f.type)),
    [fieldDefinitions],
  );

  // Reset to scan order if the active sort field doesn't exist for the
  // current game (e.g. the collection's game changed).
  useEffect(() => {
    if (!sortKey || sortKey === "scan-desc") return;
    const { field } = splitSortKey(sortKey);
    if (!fieldDefinitions.some((f) => f.field === field)) {
      setSortKey("scan-desc");
    }
  }, [fieldDefinitions, sortKey]);

  const filteredAndSorted = useMemo(() => {
    let result = cards;

    if (filters.colors.length > 0) {
      result = result.filter((entry) => {
        const identity = entry.card.color_identity ?? [];
        if (filters.colors.includes("C") && identity.length === 0) return true;
        return filters.colors.some((c) => c !== "C" && identity.includes(c));
      });
    }

    if (filters.rarities.length > 0) {
      result = result.filter((entry) =>
        filters.rarities.includes(entry.card.rarity),
      );
    }

    if (filters.bins.length > 0) {
      result = result.filter((entry) =>
        filters.bins.includes(entry.binNumber ?? null),
      );
    }

    if (filters.needsAttention) {
      result = result.filter(
        (entry) => (entry.alternativeMatches?.length ?? 0) > 0,
      );
    }

    if (!filters.showDownloaded) {
      result = result.filter((entry) => !entry.isDownloaded);
    }

    if (filters.sets.length > 0) {
      result = result.filter((entry) => filters.sets.includes(entry.card.set));
    }

    if (filters.minMatchPercent > 0) {
      result = result.filter(
        (entry) => (1 - entry.card.distance) * 100 >= filters.minMatchPercent,
      );
    }

    const query = searchQuery.toLowerCase().trim();
    if (query) {
      result = result.filter((entry) => {
        const c = entry.card;
        return (
          c.name.toLowerCase().includes(query) ||
          c.set_name.toLowerCase().includes(query) ||
          c.set.toLowerCase().includes(query) ||
          c.type_line.toLowerCase().includes(query) ||
          c.collector_number.toLowerCase().includes(query) ||
          (c.oracle_text?.toLowerCase().includes(query) ?? false)
        );
      });
    }

    if (!sortKey || sortKey === "scan-desc") return result;

    const { field, dir } = splitSortKey(sortKey);
    const meta = fieldDefinitions.find((f) => f.field === field);
    if (!meta) return result;

    const mul = dir === "asc" ? 1 : -1;
    const sorted = [...result];
    sorted.sort((a, b) => mul * compareByField(a, b, meta));
    return sorted;
  }, [cards, searchQuery, sortKey, filters, fieldDefinitions]);

  const activeFilterCount =
    filters.colors.length +
    filters.rarities.length +
    filters.bins.length +
    filters.sets.length +
    (filters.needsAttention ? 1 : 0) +
    (filters.showDownloaded ? 1 : 0) +
    (filters.minMatchPercent > 0 ? 1 : 0);

  return {
    filteredAndSorted,
    searchQuery,
    setSearchQuery,
    sortKey,
    setSortKey,
    sortableFields,
    filters,
    setFilters,
    activeFilterCount,
  };
}
