import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { searchCards } from "@/features/cards/api/card-search";
import { formatCardNumber } from "@/features/cards/lib/format-card-number";
import { QUERY_MIN_LENGTH, type PlayingCard } from "@poke-sort/shared";
import { IconLoader2, IconSearch } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface CardSearchPickerProps {
  onSelect: (card: PlayingCard) => void;
  /** Resolves the game via the active collection when set… */
  collectionGuid?: string;
  /** …or directly by game when there is no collection to name (review screen). */
  gameKey?: string;
  initialQuery?: string;
  autoFocus?: boolean;
  /** Max height class for the results area. */
  resultsClassName?: string;
}

/**
 * Debounced catalog name-search with a set filter and image-grid results.
 * Extracted from CardDetailPanel so the review screen can reuse the exact
 * same correction picker.
 */
export function CardSearchPicker({
  onSelect,
  collectionGuid,
  gameKey,
  initialQuery = "",
  autoFocus = true,
  resultsClassName = "max-h-[50vh]",
}: CardSearchPickerProps) {
  const { t } = useTranslation("cards");
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [selectedSet, setSelectedSet] = useState<string | null>("all");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const isQueryReady = debouncedQuery.trim().length >= QUERY_MIN_LENGTH;

  const { data: results = [], isFetching: loading } = useQuery({
    queryKey: ["card-search", debouncedQuery, collectionGuid, gameKey],
    queryFn: () =>
      searchCards(debouncedQuery, collectionGuid, gameKey).then(
        (r) => r.data ?? [],
      ),
    enabled: isQueryReady,
    staleTime: 60_000,
  });

  const handleInputChange = (value: string) => {
    setQuery(value);
    setSelectedSet("all");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 300);
  };

  const sets = useMemo(() => {
    const setMap = new Map<string, string>();
    for (const card of results) {
      if (!setMap.has(card.set)) setMap.set(card.set, card.setName);
    }
    return Array.from(setMap.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [results]);

  const filteredResults = useMemo(() => {
    if (selectedSet === "all") return results;
    return results.filter((card) => card.set === selectedSet);
  }, [results, selectedSet]);

  return (
    <>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
          <Input
            placeholder={t("cardDetailPanel.searchPlaceholder")}
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            className="pl-7"
            autoFocus={autoFocus}
          />
        </div>
        {sets.length > 1 && (
          <Select
            value={selectedSet}
            onValueChange={(value) => setSelectedSet(value)}
          >
            <SelectTrigger className="w-40 shrink-0">
              <SelectValue placeholder={t("cardDetailPanel.allSets")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("cardDetailPanel.allSetsCount", { count: results.length })}
              </SelectItem>
              {sets.map((s) => (
                <SelectItem key={s.code} value={s.code}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <ScrollArea
        className={`flex-1 overflow-y-auto min-h-0 border rounded-lg p-1 bg-sidebar ${resultsClassName}`}
      >
        {loading && (
          <div className="flex items-center justify-center py-8">
            <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading &&
          filteredResults.length === 0 &&
          query.trim().length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">
              {t("cardDetailPanel.startTyping")}
            </p>
          )}
        {!loading &&
          filteredResults.length === 0 &&
          query.trim().length >= QUERY_MIN_LENGTH && (
            <p className="text-center text-sm text-muted-foreground py-8">
              {t("cardDetailPanel.noCardsFound")}
            </p>
          )}
        {!loading && filteredResults.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-1.5">
            {filteredResults.map((card) => (
              <Button
                key={card.id}
                variant="ghost"
                className="relative w-full h-auto aspect-[2.5/3.5] p-0 rounded overflow-hidden group"
                onClick={() => onSelect(card)}
              >
                {card.image?.small ? (
                  <img
                    src={card.image.small}
                    alt={card.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-10 h-14 bg-muted rounded shrink-0" />
                )}
                <div className="absolute bottom-0 inset-x-0 bg-black/70 text-white text-[10px] leading-tight px-1 py-0.5 text-center truncate">
                  {[card.setName || card.set.toUpperCase(), formatCardNumber(card)]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </Button>
            ))}
          </div>
        )}
      </ScrollArea>
    </>
  );
}
