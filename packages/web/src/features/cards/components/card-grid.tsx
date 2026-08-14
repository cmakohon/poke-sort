import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBinConfigs } from "@/features/bins/api/use-bin-configs";
import { useCardFilters } from "@/features/cards/api/use-card-filters";
import { CardCollectionView } from "@/features/cards/components/card-collection-view";
import { getCollectionViewers } from "@/features/collections/api/collections";
import { useCollectionLocks } from "@/features/collections/api/use-collection-locks";
import { useCollections } from "@/features/collections/api/use-collections";
import { useScannedCards } from "@/features/scanner/api/use-scanned-cards";
import { useScannerIsland } from "@/features/scanner/api/use-scanner-island";
import { ScannerControls } from "@/features/scanner/components/scanner-controls";
import { ScannerDebug } from "@/features/scanner/components/scanner-debug";
import { SessionBar } from "@/features/scanner/components/session-bar";
import { IconAlbum, IconArrowBarToDown, IconBolt } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

/**
 * The scan screen's card list — this run's staged cards.
 *
 * It used to be the active collection's entire contents, because every scan
 * was written straight into that collection. The grid itself now lives in
 * CardCollectionView, shared with the collection detail screen; what is left
 * here is the scanner wiring: controls, feed buttons, and the session bar that
 * ends the run.
 */
export function CardGrid() {
  const { t } = useTranslation("cards");
  const { activeCollection, isLoading: collectionsLoading } = useCollections();
  const {
    cards,
    session,
    removeCard,
    removeCards,
    correctCard,
    toggleFoil,
    markDownloaded,
    addCard,
    isLoading,
    elapsedMs,
    autoFeed,
    setAutoFeed,
  } = useScannedCards();
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
  const cardFilters = useCardFilters();
  const { fieldDefinitions } = useBinConfigs();

  if (!collectionsLoading && !activeCollection) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <IconAlbum className="size-10" />
        <div className="text-center">
          <p className="text-sm font-medium">
            {t("cardGrid.noCollectionSelected")}
          </p>
          <p className="text-xs">{t("cardGrid.createOrSelectCollection")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          render={
            <Link to="/collections">{t("cardGrid.manageCollections")}</Link>
          }
        ></Button>
      </div>
    );
  }

  const scannerControls = scanner?.isCameraActive ? (
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
                  {scanner.isFeeding ? t("cardGrid.feeding") : t("cardGrid.feed")}
                </Button>
              }
            />
            <TooltipContent>{t("cardGrid.feedTooltip")}</TooltipContent>
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
                ? t("cardGrid.autoFeedOnTooltip")
                : t("cardGrid.autoFeedOffTooltip")}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  onClick={scanner.handleClearDevice}
                  disabled={!scanner.isReady || scanner.isClearingDevice}
                >
                  <IconArrowBarToDown />
                </Button>
              }
            />
            <TooltipContent>{t("cardGrid.clearDeviceTooltip")}</TooltipContent>
          </Tooltip>
        </>
      )}
      <ScannerDebug />
    </>
  ) : null;

  // The bar stays up after the camera is closed: a finished run still has to
  // be saved or discarded.
  const footerSlot =
    scannerControls || (session && cards.length > 0) ? (
      <>
        {scannerControls}
        <div className="flex-1" />
        <SessionBar />
      </>
    ) : null;

  // The scan screen used to show the active collection's whole history, so
  // after the move to sessions it looks alarmingly empty on first launch. Say
  // where those cards went.
  const emptyState = (
    <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground flex-1">
      <p className="text-sm font-medium">{t("cardGrid.noCardsScanned")}</p>
      <p className="text-xs">{t("cardGrid.scanToGetStarted")}</p>
      {activeCollection && (
        <>
          <p className="text-xs max-w-sm text-center pt-2">
            {t("cardGrid.sessionExplainer")}
          </p>
          <Button
            variant="outline"
            size="sm"
            render={
              <Link to={`/collections/${activeCollection.guid}`}>
                {t("cardGrid.viewCollection", { name: activeCollection.name })}
              </Link>
            }
          />
        </>
      )}
    </div>
  );

  return (
    <CardCollectionView
      cards={cards}
      fieldDefinitions={fieldDefinitions}
      isLoading={isLoading}
      emptyState={emptyState}
      collectionName={activeCollection?.name}
      searchCollectionGuid={activeCollection?.guid}
      externalFilters={cardFilters}
      elapsedMs={elapsedMs}
      resetPageKey={session?.guid}
      onRemoveCard={removeCard}
      onRemoveCards={removeCards}
      onCorrectCard={correctCard}
      onToggleFoil={toggleFoil}
      onMarkDownloaded={markDownloaded}
      onAddCard={addCard}
      toolbarWatchers={viewers}
      deleteScope="session"
      footerSlot={footerSlot}
    />
  );
}
