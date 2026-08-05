import { DeleteDialog } from "@/components/delete-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBinConfigs } from "@/features/bins/api/use-bin-configs";
import { useCardFilterSort } from "@/features/cards/api/use-card-filter-sort";
import { useCardFilters } from "@/features/cards/api/use-card-filters";
import { CardDetailPanel } from "@/features/cards/components/card-detail-panel";
import { CardToolbar } from "@/features/cards/components/card-toolbar";
import { ScannedCardItem } from "@/features/cards/components/scanned-card-item";
import { SessionSummaryDialog } from "@/features/cards/components/session-summary-dialog";
import { getCollectionViewers } from "@/features/collections/api/collections";
import { useCollectionLocks } from "@/features/collections/api/use-collection-locks";
import { useCollections } from "@/features/collections/api/use-collections";
import { useScannedCards } from "@/features/scanner/api/use-scanned-cards";
import { useScannerIsland } from "@/features/scanner/api/use-scanner-island";
import { ScannerControls } from "@/features/scanner/components/scanner-controls";
import { ScannerDebug } from "@/features/scanner/components/scanner-debug";
import { computeStats } from "@/features/scanner/lib/compute-stats";

import {
  IconAlbum,
  IconArrowBarToDown,
  IconBolt,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const PAGE_SIZE = 96;

export function CardGrid() {
  const {
    activeCollection,
    deleteCollection,
    isLoading: collectionsLoading,
  } = useCollections();
  const {
    cards,
    removeCard,
    removeCards,
    clearCards,
    markDownloaded,
    isLoading,
    elapsedMs,
    autoFeed,
    setAutoFeed,
  } = useScannedCards();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const scanner = useScannerIsland();
  const { locks, currentUserId } = useCollectionLocks();
  const isScanningActive = !!(
    activeCollection && locks[activeCollection.guid]?.userId === currentUserId
  );
  const { data: viewersRaw } = useQuery({
    queryKey: ["collection-viewers", activeCollection?.guid],
    queryFn: () => getCollectionViewers(activeCollection!.guid),
    enabled: isScanningActive,
    refetchInterval: 5000,
  });
  const viewers = viewersRaw?.filter((v) => v.userId !== currentUserId);
  const { filters, setFilters } = useCardFilters();
  const { fieldDefinitions } = useBinConfigs();
  const {
    filteredAndSorted,
    searchQuery,
    setSearchQuery,
    sortKey,
    setSortKey,
    sortableFields,
    activeFilterCount,
  } = useCardFilterSort(cards, fieldDefinitions, { filters, setFilters });
  const stats = useMemo(() => computeStats(cards), [cards]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [openScanId, setOpenScanId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredAndSorted.length / PAGE_SIZE),
  );
  const clampedPage = Math.min(page, pageCount - 1);
  const pagedCards = filteredAndSorted.slice(
    clampedPage * PAGE_SIZE,
    (clampedPage + 1) * PAGE_SIZE,
  );

  useEffect(() => {
    setPage(0);
  }, [searchQuery, filters, sortKey, activeCollection?.guid]);

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
    removeCards(Array.from(selectedIds));
    setSelectedIds(new Set());
  }, [removeCards, selectedIds]);

  const handleClearSession = useCallback(async () => {
    if (activeCollection) {
      await deleteCollection(activeCollection.guid);
    } else {
      clearCards();
    }
  }, [activeCollection, deleteCollection, clearCards]);

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

  if (!collectionsLoading && !activeCollection) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <IconAlbum className="size-10" />
        <div className="text-center">
          <p className="text-sm font-medium">No collection selected</p>
          <p className="text-xs">
            Create or select a collection to start scanning
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          render={<Link to="/app/collections">Manage Collections</Link>}
        ></Button>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground flex-1">
          <p className="text-sm font-medium">No cards scanned yet</p>
          <p className="text-xs">Scan a card to get started</p>
        </div>
        {scanner?.isCameraActive && (
          <div className="sticky bottom-0 z-10 bg-background/80 backdrop-blur-2xl p-2 border-t">
            <div className="flex flex-row gap-2 items-center w-full">
              <ScannerControls
                status={scanner.status}
                onForceAddDuplicate={scanner.handleForceAddDuplicate}
                onForceScan={scanner.handleForceScan}
                onSkipDuplicate={scanner.handleSkipDuplicate}
                onPause={scanner.handlePause}
                onResume={scanner.handleResume}
              />
              {scanner.isConnected && (
                <>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          onClick={scanner.handleFeed}
                          disabled={!scanner.isReady || scanner.isFeeding}
                        >
                          {scanner.isFeeding ? "Feeding…" : "Feed"}
                        </Button>
                      }
                    />
                    <TooltipContent>
                      Advance one card from the hopper into the scanner
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant={autoFeed ? "default" : "outline"}
                          size="icon"
                          onClick={() => setAutoFeed(!autoFeed)}
                        >
                          <IconBolt />
                        </Button>
                      }
                    />
                    <TooltipContent>
                      {autoFeed
                        ? "Auto-feed on — next card feeds automatically after each scan"
                        : "Auto-feed off — feed each card manually"}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={scanner.handleClearDevice}
                          disabled={
                            !scanner.isReady || scanner.isClearingDevice
                          }
                        >
                          <IconArrowBarToDown />
                        </Button>
                      }
                    />
                    <TooltipContent>
                      Clear device (opens all bottom paddles)
                    </TooltipContent>
                  </Tooltip>
                </>
              )}
              <ScannerDebug />
            </div>
          </div>
        )}
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
        onClose={() => setOpenScanId(null)}
        onRemove={() => {
          removeCard(openEntry.scanId);
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
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-2xl p-2 border-b">
        <CardToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          sortKey={sortKey}
          onSortChange={setSortKey}
          sortableFields={sortableFields}
          onExport={() => setSummaryOpen(true)}
          collectionName={activeCollection?.name}
          onClearAll={handleClearSession}
          hasCards={filteredAndSorted.length > 0}
          activeFilters={filters}
          onFiltersChange={setFilters}
          activeFilterCount={activeFilterCount}
          watchers={viewers}
          allSelected={allSelected}
          onToggleSelectAll={toggleSelectAll}
          availableRarities={stats?.rarities}
          availableColors={stats?.colors}
        />
      </div>
      {filteredAndSorted.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground flex-1">
          <p className="text-sm font-medium">
            No cards match the current filters
          </p>
          <p className="text-xs">
            Try adjusting your search, sort, or filter options
          </p>
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
              Page {clampedPage + 1} of {pageCount}
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

      {(scanner?.isCameraActive || selectedIds.size > 0) && (
        <div className="sticky bottom-0 z-10 bg-background/80 backdrop-blur-2xl p-2 border-t">
          <div className="flex flex-row gap-2 items-center w-full">
            {scanner?.isCameraActive && (
              <>
                <ScannerControls
                  status={scanner.status}
                  onForceAddDuplicate={scanner.handleForceAddDuplicate}
                  onForceScan={scanner.handleForceScan}
                  onSkipDuplicate={scanner.handleSkipDuplicate}
                  onPause={scanner.handlePause}
                  onResume={scanner.handleResume}
                />
                {scanner.isConnected && (
                  <>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            onClick={scanner.handleFeed}
                            disabled={!scanner.isReady || scanner.isFeeding}
                          >
                            {scanner.isFeeding ? "Feeding…" : "Feed"}
                          </Button>
                        }
                      />
                      <TooltipContent>
                        Advance one card from the hopper into the scanner
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant={autoFeed ? "default" : "outline"}
                            size="icon"
                            onClick={() => setAutoFeed(!autoFeed)}
                          >
                            <IconBolt />
                          </Button>
                        }
                      />
                      <TooltipContent>
                        {autoFeed
                          ? "Auto-feed on — next card feeds automatically after each scan"
                          : "Auto-feed off — feed each card manually"}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={scanner.handleClearDevice}
                            disabled={
                              !scanner.isReady || scanner.isClearingDevice
                            }
                          >
                            <IconArrowBarToDown />
                          </Button>
                        }
                      />
                      <TooltipContent>
                        Clear device (opens all bottom paddles)
                      </TooltipContent>
                    </Tooltip>
                  </>
                )}
                <ScannerDebug />
              </>
            )}
            {selectedIds.size > 0 && (
              <>
                {scanner?.isCameraActive && (
                  <div className="w-px h-5 bg-border mx-1 shrink-0" />
                )}
                <span className="text-sm text-muted-foreground">
                  {selectedIds.size} {selectedIds.size === 1 ? "card" : "cards"}{" "}
                  selected
                </span>
                <Button
                  variant="ghost"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setConfirmOpen(true)}
                >
                  Delete
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <SessionSummaryDialog
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
        cards={cards}
        elapsedMs={elapsedMs}
        collectionName={activeCollection?.name ?? "collection"}
        onMarkDownloaded={markDownloaded}
      />

      <DeleteDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete ${selectedIds.size} ${selectedIds.size === 1 ? "card" : "cards"}?`}
        description={`This will permanently remove the selected ${selectedIds.size === 1 ? "card" : "cards"} from your collection. This action cannot be undone.`}
        confirm={{ type: "keyword" }}
        onConfirm={handleBulkDelete}
      />
    </>
  );
}
