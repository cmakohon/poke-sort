import type { CardFilters } from "@/features/cards/types";
import { createContext, useCallback, useContext, useState } from "react";

// showDownloaded defaults to true: exporting marks every card downloaded, and
// hiding them by default made a whole grid silently vanish after an export.
export const EMPTY_CARD_FILTERS: CardFilters = {
  types: [],
  rarities: [],
  bins: [],
  needsAttention: false,
  showDownloaded: true,
  sets: [],
  minMatchPercent: 0,
};

function toggleItem<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

interface CardFiltersContextValue {
  filters: CardFilters;
  setFilters: (filters: CardFilters) => void;
  toggleRarity: (rarity: string) => void;
  toggleType: (type: string) => void;
  toggleSet: (setCode: string) => void;
}

const CardFiltersContext = createContext<CardFiltersContextValue | null>(null);

export function CardFiltersProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState<CardFilters>(EMPTY_CARD_FILTERS);

  const toggleRarity = useCallback((rarity: string) => {
    setFilters((prev) => ({ ...prev, rarities: toggleItem(prev.rarities, rarity) }));
  }, []);

  const toggleType = useCallback((type: string) => {
    setFilters((prev) => ({ ...prev, types: toggleItem(prev.types, type) }));
  }, []);

  const toggleSet = useCallback((setCode: string) => {
    setFilters((prev) => ({ ...prev, sets: toggleItem(prev.sets, setCode) }));
  }, []);

  return (
    <CardFiltersContext
      value={{ filters, setFilters, toggleRarity, toggleType, toggleSet }}
    >
      {children}
    </CardFiltersContext>
  );
}

export function useCardFilters() {
  const context = useContext(CardFiltersContext);
  if (!context) {
    throw new Error("useCardFilters must be used within a CardFiltersProvider");
  }
  return context;
}
