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
import {
  searchCards,
  type CardSearchSetFacet,
} from "@/features/cards/api/card-search";
import { formatCardNumber } from "@/features/cards/lib/format-card-number";
import { QUERY_MIN_LENGTH, type PlayingCard } from "@poke-sort/shared";
import { IconLoader2, IconSearch } from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
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
 *
 * Paged, and both the count and the set list describe the whole match rather
 * than what came back. The previous version showed the first 30 hits of an
 * upstream query and filtered those client-side, so a common Pokemon's right
 * printing was frequently unreachable with nothing on screen to say so.
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
  const [selectedSet, setSelectedSet] = useState("all");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const isQueryReady = debouncedQuery.trim().length >= QUERY_MIN_LENGTH;

  const {
    data,
    isFetching: loading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["card-search", debouncedQuery, selectedSet, collectionGuid, gameKey],
    queryFn: ({ pageParam }) =>
      searchCards(debouncedQuery, {
        collectionGuid,
        gameKey,
        setCode: selectedSet === "all" ? undefined : selectedSet,
        page: pageParam,
      }).then((r) => {
        // Surfaced rather than swallowed: a rejected request used to render as
        // "No cards found", which reads as "that printing does not exist".
        if (!r.success || !r.data) throw new Error(r.message);
        return r.data;
      }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.limit < last.total ? last.page + 1 : undefined,
    enabled: isQueryReady,
    staleTime: 60_000,
  });

  const handleInputChange = (value: string) => {
    setQuery(value);
    setSelectedSet("all");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 300);
  };

  const results = useMemo(
    () => data?.pages.flatMap((p) => p.cards) ?? [],
    [data],
  );
  const total = data?.pages[0]?.total ?? 0;

  // The dropdown has to describe the *unfiltered* match. The server counts
  // only the chosen set once one is chosen, and a dropdown that then listed a
  // single option would be a trapdoor. Typing resets the filter to "all", so
  // the unfiltered facets are always fetched first — remember them.
  const unfilteredRef = useRef<{ sets: CardSearchSetFacet[]; total: number }>({
    sets: [],
    total: 0,
  });
  if (selectedSet === "all" && data?.pages[0]) {
    unfilteredRef.current = {
      sets: data.pages[0].sets,
      total: data.pages[0].total,
    };
  }
  const sets = [...unfilteredRef.current.sets].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

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
            onValueChange={(value) => setSelectedSet(value ?? "all")}
          >
            <SelectTrigger className="w-40 shrink-0">
              {/* Base UI renders the raw value without children — here a set
                  code rather than the set name. */}
              <SelectValue placeholder={t("cardDetailPanel.allSets")}>
                {selectedSet === "all"
                  ? t("cardDetailPanel.allSetsCount", {
                      count: unfilteredRef.current.total,
                    })
                  : (sets.find((s) => s.code === selectedSet)?.name ??
                    selectedSet)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("cardDetailPanel.allSetsCount", {
                  count: unfilteredRef.current.total,
                })}
              </SelectItem>
              {sets.map((s) => (
                <SelectItem key={s.code} value={s.code}>
                  {t("cardDetailPanel.setWithCount", {
                    name: s.name,
                    count: s.count,
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <ScrollArea
        className={`flex-1 overflow-y-auto min-h-0 border rounded-lg p-1 bg-sidebar ${resultsClassName}`}
      >
        {/* Only the first page blanks the grid — a "load more" keeps what is
            already on screen and spins on the button instead. */}
        {loading && !isFetchingNextPage && (
          <div className="flex items-center justify-center py-8">
            <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && isError && (
          <p className="text-center text-sm text-destructive py-8">
            {t("cardDetailPanel.searchFailed")}
          </p>
        )}
        {!loading && !isError && results.length === 0 && query.trim().length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-8">
            {t("cardDetailPanel.startTyping")}
          </p>
        )}
        {!loading &&
          !isError &&
          results.length === 0 &&
          query.trim().length >= QUERY_MIN_LENGTH && (
            <p className="text-center text-sm text-muted-foreground py-8">
              {t("cardDetailPanel.noCardsFound")}
            </p>
          )}
        {results.length > 0 && (!loading || isFetchingNextPage) && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-1.5">
            {results.map((card) => (
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
        {/* The count is the whole match, not the page. Without it there is no
            way to tell "that is every printing" from "that is the first 60". */}
        {results.length > 0 && (
          <div className="flex flex-col items-center gap-2 py-3">
            <p className="text-xs text-muted-foreground tabular-nums">
              {t("cardDetailPanel.showingCount", {
                shown: results.length,
                total,
              })}
            </p>
            {hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                disabled={isFetchingNextPage}
                onClick={() => fetchNextPage()}
              >
                {isFetchingNextPage && (
                  <IconLoader2 className="size-3.5 animate-spin" />
                )}
                {t("cardDetailPanel.loadMore")}
              </Button>
            )}
          </div>
        )}
      </ScrollArea>
    </>
  );
}
