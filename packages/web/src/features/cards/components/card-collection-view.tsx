import { DeleteDialog } from "@/components/delete-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCardFilterSort } from "@/features/cards/api/use-card-filter-sort";
import { EMPTY_CARD_FILTERS } from "@/features/cards/api/use-card-filters";
import { CardDetailPanel } from "@/features/cards/components/card-detail-panel";
import { CardToolbar } from "@/features/cards/components/card-toolbar";
import { ScannedCardItem } from "@/features/cards/components/scanned-card-item";
import { SessionSummaryDialog } from "@/features/cards/components/session-summary-dialog";
import type { CardFilters } from "@/features/cards/types";
import { computeStats } from "@/features/scanner/lib/compute-stats";
import type {
  FieldMeta,
  PlayingCard,
  PlayingCardWithDistance,
  ScannedCard,
} from "@poke-sort/shared";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

const PAGE_SIZE = 96;

/**
 * A searchable, filterable, editable grid of cards.
 *
 * Extracted from CardGrid, which was welded to the scanner: it pulled its
 * cards from useScannedCards and its mutations from whichever collection was
 * active, so there was no way to look inside a collection you were not
 * scanning into. Everything scanner-specific now arrives through footerSlot
 * and the mutation callbacks, which is what lets the scan screen and the
 * collection detail screen share this.
 */
export interface CardCollectionViewProps {
  cards: ScannedCard[];
  fieldDefinitions: FieldMeta[];
  isLoading?: boolean;
  collectionName?: string;
  /** Which collection's game/lang the catalog search should resolve. */
  searchCollectionGuid?: string;
  /**
   * Share filter state with the rest of the app. The scan screen passes the
   * app-wide CardFilters context so its stat chips can drive the grid; the
   * collection screen must NOT, or filtering a collection would silently
   * change what the scan screen shows.
   */
  externalFilters?: { filters: CardFilters; setFilters: (f: CardFilters) => void };
  /** Drives the export dialog's elapsed-time line; scan screen only. */
  elapsedMs?: number;
  /** Resets paging when the underlying list is swapped out. */
  resetPageKey?: string;
  onRemoveCard: (scanId: string) => void;
  onRemoveCards: (scanIds: string[]) => void;
  onCorrectCard: (scanId: string, card: PlayingCard) => void;
  onToggleFoil: (scanId: string, isFoil: boolean) => void;
  onMarkDownloaded: (scanIds: string[]) => void;
  /** Manual add from the detail panel. Scan screen only. */
  onAddCard?: (card: PlayingCardWithDistance) => void;
  /**
   * Empties the whole collection. Deliberately absent on the scan screen,
   * where the destructive action is "discard this run" and belongs to the
   * session bar instead.
   */
  onClearAll?: () => Promise<void> | void;
  /** Shown instead of the grid when there are no cards at all. */
  emptyState?: ReactNode;
  /** Sticky bottom bar — scanner controls, session bar, bulk actions. */
  footerSlot?: ReactNode;
  toolbarWatchers?: { userId: string; displayName: string }[];
  /**
   * What deleting a card actually means here. On the scan screen the cards are
   * staged and have never reached a collection, so "removed from your
   * collection" was simply untrue.
   */
  deleteScope?: "session" | "collection";
  /**
   * Whether the detail panel offers the scan's other candidates. On the scan
   * screen the match is still an open question; in a collection it is settled.
   */
  showCandidates?: boolean;
}

export function CardCollectionView({
  cards,
  fieldDefinitions,
  isLoading,
  collectionName,
  searchCollectionGuid,
  externalFilters,
  elapsedMs,
  resetPageKey,
  onRemoveCard,
  onRemoveCards,
  onCorrectCard,
  onToggleFoil,
  onMarkDownloaded,
  onAddCard,
  onClearAll,
  emptyState,
  footerSlot,
  toolbarWatchers,
  deleteScope = "collection",
  showCandidates = true,
}: CardCollectionViewProps) {
  const { t } = useTranslation("cards");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const {
    filteredAndSorted,
    searchQuery,
    setSearchQuery,
    sortKey,
    setSortKey,
    sortableFields,
    activeFilterCount,
    filters,
    setFilters,
  } = useCardFilterSort(cards, fieldDefinitions, externalFilters);
  const stats = useMemo(() => computeStats(cards), [cards]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [openScanId, setOpenScanId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(filteredAndSorted.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pagedCards = filteredAndSorted.slice(
    clampedPage * PAGE_SIZE,
    (clampedPage + 1) * PAGE_SIZE,
  );

  useEffect(() => {
    setPage(0);
  }, [searchQuery, filters, sortKey, resetPageKey]);

  const openIndex = openScanId
    ? filteredAndSorted.findIndex((c) => c.scanId === openScanId)
    : -1;
  const openEntry = openIndex >= 0 ? filteredAndSorted[openIndex] : null;

  const toggleSelect = useCallback((scanId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(scanId)) next.delete(scanId);
      else next.add(scanId);
      return next;
    });
  }, []);

  const allSelected =
    filteredAndSorted.length > 0 &&
    filteredAndSorted.every((card) => selectedIds.has(card.scanId));

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allCurrentlySelected =
        filteredAndSorted.length > 0 &&
        filteredAndSorted.every((card) => prev.has(card.scanId));
      return allCurrentlySelected
        ? new Set()
        : new Set(filteredAndSorted.map((card) => card.scanId));
    });
  }, [filteredAndSorted]);

  const handleBulkDelete = useCallback(() => {
    onRemoveCards(Array.from(selectedIds));
    setSelectedIds(new Set());
  }, [onRemoveCards, selectedIds]);

  if (isLoading) {
    return (
      <>
        <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-2xl p-2 border-b">
          <div className="flex flex-row gap-2 items-center w-full">
            <Skeleton className="h-9 flex-1 rounded-md" />
            <Skeleton className="h-9 w-full sm:w-64 rounded-md shrink-0" />
            <Skeleton className="size-9 rounded-md shrink-0" />
            <Skeleton className="size-9 rounded-md shrink-0" />
            <Skeleton className="size-9 rounded-md shrink-0" />
          </div>
        </div>
        <div className="p-2 flex-1">
          <div className="grid grid-cols-3 @md:grid-cols-4 @4xl:grid-cols-6 gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="rounded-lg p-1 bg-muted border">
                <Skeleton className="aspect-[2.5/3.5] rounded-lg" />
                <div className="flex flex-row justify-between items-center px-1 pb-1">
                  <div className="flex flex-row items-center gap-2">
                    <Skeleton className="size-3 rounded-full shrink-0" />
                    <Skeleton className="h-3 w-8 rounded" />
                    <Skeleton className="h-3 w-6 rounded" />
                  </div>
                  <Skeleton className="h-3 w-8 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  // The footer's children are laid out by this row, not by themselves — drop
  // the wrapper and the scanner's buttons stack vertically at full width.
  const footer = (extra?: ReactNode) =>
    footerSlot || extra ? (
      <div className="sticky bottom-0 z-20 bg-background/80 backdrop-blur-2xl p-2 border-t">
        <div className="flex flex-row gap-2 items-center w-full">
          {extra}
          {footerSlot}
        </div>
      </div>
    ) : null;

  if (cards.length === 0) {
    return (
      <>
        {emptyState ?? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground flex-1">
            <p className="text-sm font-medium">{t("cardGrid.noCardsScanned")}</p>
            <p className="text-xs">{t("cardGrid.scanToGetStarted")}</p>
          </div>
        )}
        {footer()}
      </>
    );
  }

  if (openEntry) {
    return (
      <CardDetailPanel
        scanId={openEntry.scanId}
        currentCard={openEntry.card}
        alternativeMatches={openEntry.alternativeMatches}
        capturedImageUrl={openEntry.capturedImageUrl}
        isFoil={openEntry.isFoil}
        binNumber={openEntry.binNumber}
        needsReview={openEntry.needsReview}
        scanScore={openEntry.score}
        scanMargin={openEntry.margin}
        searchCollectionGuid={searchCollectionGuid}
        fieldDefinitions={fieldDefinitions}
        showCandidates={showCandidates}
        onCorrect={onCorrectCard}
        onAdd={onAddCard}
        onToggleFoil={onToggleFoil}
        onClose={() => setOpenScanId(null)}
        onRemove={() => {
          onRemoveCard(openEntry.scanId);
          setOpenScanId(null);
        }}
        onPrev={() =>
          setOpenScanId(filteredAndSorted[openIndex - 1]?.scanId ?? null)
        }
        onNext={() =>
          setOpenScanId(filteredAndSorted[openIndex + 1]?.scanId ?? null)
        }
        hasPrev={openIndex > 0}
        hasNext={openIndex < filteredAndSorted.length - 1}
        currentIndex={openIndex}
        total={filteredAndSorted.length}
      />
    );
  }

  return (
    <>
      <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-2xl p-2 border-b">
        <CardToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          sortKey={sortKey}
          onSortChange={setSortKey}
          sortableFields={sortableFields}
          onExport={() => setSummaryOpen(true)}
          collectionName={collectionName}
          onClearAll={onClearAll}
          hasCards={filteredAndSorted.length > 0}
          activeFilters={filters}
          onFiltersChange={setFilters}
          activeFilterCount={activeFilterCount}
          watchers={toolbarWatchers}
          allSelected={allSelected}
          onToggleSelectAll={toggleSelectAll}
          availableRarities={stats?.rarities}
          availableTypes={stats?.types}
          availableSets={stats?.sets}
        />
      </div>
      {filteredAndSorted.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground flex-1">
          <div className="text-center">
            <p className="text-sm font-medium">
              {t("cardGrid.noCardsMatchFilters")}
            </p>
            <p className="text-xs">{t("cardGrid.tryAdjusting")}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFilters(EMPTY_CARD_FILTERS);
              setSearchQuery("");
            }}
          >
            {t("cardGrid.clearFilters")}
          </Button>
        </div>
      )}
      <div className="p-2 flex-1">
        <div className="grid grid-cols-3 @md:grid-cols-4 @4xl:grid-cols-6 gap-2">
          {pagedCards.map((card) => (
            <ScannedCardItem
              key={card.scanId}
              card={card.card}
              onOpen={() => setOpenScanId(card.scanId)}
              binNumber={card.binNumber}
              isSelected={selectedIds.has(card.scanId)}
              onToggleSelect={() => toggleSelect(card.scanId)}
              hasAlternatives={!!card.alternativeMatches?.length}
              isFoil={card.isFoil}
              isDownloaded={card.isDownloaded}
              wasCorrected={card.wasCorrected}
              needsReview={card.needsReview}
              reviewVerdict={card.reviewVerdict}
            />
          ))}
        </div>
        {pageCount > 1 && (
          <div className="flex items-center justify-center gap-3 pt-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={clampedPage === 0}
            >
              <IconChevronLeft />
            </Button>
            <span className="text-sm text-muted-foreground">
              {t("cardGrid.pageOf", { page: clampedPage + 1, total: pageCount })}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={clampedPage === pageCount - 1}
            >
              <IconChevronRight />
            </Button>
          </div>
        )}
      </div>

      {footer(
        selectedIds.size > 0 ? (
          <>
            <span className="text-sm text-muted-foreground">
              {t("cardGrid.cardsSelected", { count: selectedIds.size })}
            </span>
            <Button variant="ghost" onClick={() => setSelectedIds(new Set())}>
              {t("cardGrid.clear")}
            </Button>
            <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
              {t("cardGrid.delete")}
            </Button>
          </>
        ) : null,
      )}

      <SessionSummaryDialog
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
        cards={cards}
        elapsedMs={elapsedMs ?? 0}
        collectionName={collectionName ?? "collection"}
        onMarkDownloaded={onMarkDownloaded}
      />

      <DeleteDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("cardGrid.deleteCardsTitle", { count: selectedIds.size })}
        description={t(
          deleteScope === "session"
            ? "cardGrid.deleteCardsDescriptionSession"
            : "cardGrid.deleteCardsDescription",
          { count: selectedIds.size },
        )}
        confirm={{ type: "keyword" }}
        onConfirm={handleBulkDelete}
      />
    </>
  );
}
