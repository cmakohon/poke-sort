import {
  type PlayingCard,
  type PlayingCardWithDistance,
  type ScanOutcome,
  type ScannedCard,
  evaluateCardBin,
  getCatchAllBin,
} from "@poke-sort/shared";

import { useBinConfigs } from "@/features/bins/api/use-bin-configs";
import {
  addCollectionCard,
  clearCollectionCards,
  loadCollectionCards,
  markCollectionCardsDownloaded,
  releaseScanLock,
  removeCollectionCard,
  removeCollectionCards,
  setCollectionCardFoil,
  updateCollectionCard,
} from "@/features/collections/api/collections";
import { useCollectionLocks } from "@/features/collections/api/use-collection-locks";
import { useCollections } from "@/features/collections/api/use-collections";
import { reportSerialEvent } from "@/features/notifications/api/notification-settings";
import { useScanTimer } from "@/features/scanner/api/use-scan-timer";
import { useSerial } from "@/features/scanner/api/use-serial";
import type { ScannedCardsContextValue } from "@/features/scanner/types";
import { generateScanId } from "@/lib/utils";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const ScannedCardsContext = createContext<ScannedCardsContextValue | null>(
  null,
);

export function ScannedCardsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useTranslation("scanner");
  const [cards, setCards] = useState<ScannedCard[]>([]);
  // correctCard needs the pre-correction record to preserve what the pipeline
  // originally predicted, and runs from a stable callback.
  const cardsRef = useRef<ScannedCard[]>(cards);
  cardsRef.current = cards;
  const [isLoading, setIsLoading] = useState(true);
  const { configs: binConfigs, fieldDefinitions } = useBinConfigs();
  const { sendBin, sendCommand, receiveResponse, isConnected, isReady } =
    useSerial();
  const { activeCollection } = useCollections();

  const { locks, currentUserId } = useCollectionLocks();
  const locksRef = useRef(locks);
  const currentUserIdRef = useRef(currentUserId);

  useEffect(() => {
    locksRef.current = locks;
  }, [locks]);
  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  const binConfigsRef = useRef(binConfigs);
  const fieldDefinitionsRef = useRef(fieldDefinitions);
  const serialRef = useRef({
    sendBin,
    sendCommand,
    receiveResponse,
    isConnected,
    isReady,
  });
  const activeCollectionRef = useRef(activeCollection);
  const prevCollectionGuidRef = useRef<string | undefined>(undefined);
  const [autoFeed, setAutoFeedState] = useState(true);
  const autoFeedRef = useRef(true);
  const cardArrivedHookRef = useRef<(() => void) | null>(null);
  const pauseHookRef = useRef<(() => void) | null>(null);
  const [timerTrigger, setTimerTrigger] = useState<number | undefined>(
    undefined,
  );
  const [timerResetSignal, setTimerResetSignal] = useState(0);
  const { elapsedMs, isActive: isTimerActive } = useScanTimer(
    timerTrigger,
    timerResetSignal,
  );

  useEffect(() => {
    binConfigsRef.current = binConfigs;
  }, [binConfigs]);

  useEffect(() => {
    fieldDefinitionsRef.current = fieldDefinitions;
  }, [fieldDefinitions]);

  useEffect(() => {
    serialRef.current = {
      sendBin,
      sendCommand,
      receiveResponse,
      isConnected,
      isReady,
    };
  }, [sendBin, sendCommand, receiveResponse, isConnected, isReady]);

  const setAutoFeed = useCallback((enabled: boolean) => {
    autoFeedRef.current = enabled;
    setAutoFeedState(enabled);
  }, []);

  const registerCardArrivedHook = useCallback((fn: () => void) => {
    cardArrivedHookRef.current = fn;
    return () => {
      if (cardArrivedHookRef.current === fn) cardArrivedHookRef.current = null;
    };
  }, []);

  const registerPauseHook = useCallback((fn: () => void) => {
    pauseHookRef.current = fn;
    return () => {
      if (pauseHookRef.current === fn) pauseHookRef.current = null;
    };
  }, []);

  const triggerAutoFeed = useCallback(async () => {
    const sent = await serialRef.current.sendCommand(
      JSON.stringify({ feeder: true }),
    );
    if (!sent) {
      autoFeedRef.current = false;
      setAutoFeedState(false);
      toast.error(t("scannedCards.autoFeedFailed.title"), {
        description: t("scannedCards.autoFeedFailed.description"),
      });
      void reportSerialEvent({
        command: "auto-feed",
        sent: false,
        response: null,
      });
      return;
    }
    const response = await serialRef.current.receiveResponse(10000);
    if (!response) {
      autoFeedRef.current = false;
      setAutoFeedState(false);
      toast.error(t("scannedCards.autoFeedTimeout.title"), {
        description: t("scannedCards.autoFeedTimeout.description"),
      });
      void reportSerialEvent({
        command: "auto-feed",
        sent: true,
        response: null,
      });
      return;
    }
    try {
      const parsed = JSON.parse(response) as Record<string, unknown>;
      if (parsed.empty) {
        autoFeedRef.current = false;
        setAutoFeedState(false);
        pauseHookRef.current?.();
        toast.error(t("scannedCards.feederEmpty.title"), {
          description: t("scannedCards.feederEmpty.description"),
          duration: Infinity,
          dismissible: true,
        });
        void reportSerialEvent({
          command: "auto-feed",
          sent: true,
          response: parsed,
        });
      } else if (parsed.error) {
        autoFeedRef.current = false;
        setAutoFeedState(false);
        toast.error(t("scannedCards.feederError.title"), {
          description: String(parsed.error),
          duration: Infinity,
          dismissible: true,
        });
        void reportSerialEvent({
          command: "auto-feed",
          sent: true,
          response: parsed,
        });
      } else {
        cardArrivedHookRef.current?.();
      }
    } catch {
      autoFeedRef.current = false;
      setAutoFeedState(false);
      toast.error(t("scannedCards.autoFeedError.title"), {
        description: t("scannedCards.autoFeedError.description"),
      });
      void reportSerialEvent({ command: "auto-feed", sent: true, response });
    }
  }, [t]);

  useEffect(() => {
    const prev = prevCollectionGuidRef.current;
    const next = activeCollection?.guid;
    if (prev && prev !== next) {
      releaseScanLock(prev).catch(() => {});
    }
    prevCollectionGuidRef.current = next;
    activeCollectionRef.current = activeCollection;
  }, [activeCollection]);

  useEffect(() => {
    return () => {
      const guid = activeCollectionRef.current?.guid;
      if (guid) releaseScanLock(guid).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!activeCollection) {
      setCards([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setCards([]);
    setIsLoading(true);

    loadCollectionCards(activeCollection.guid)
      .then((r) => {
        if (!cancelled) setCards(r.data ?? []);
      })
      .catch((err) => {
        if (!cancelled) console.error("Failed to load collection cards:", err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeCollection?.guid]); // eslint-disable-line react-hooks/exhaustive-deps

  const addCard = useCallback(
    (
      card: PlayingCardWithDistance,
      capturedImageUrl?: string,
      alternativeMatches?: PlayingCardWithDistance[],
      outcome?: ScanOutcome,
    ) => {
      const collection = activeCollectionRef.current;
      if (!collection) {
        toast.error(t("scannedCards.noCollectionSelected.title"), {
          description: t("scannedCards.noCollectionSelected.description"),
        });
        return;
      }

      const lock = locksRef.current?.[collection.guid];
      if (lock && lock.userId !== currentUserIdRef.current) {
        toast.error(t("scannedCards.collectionLocked.title"), {
          description: t("scannedCards.collectionLocked.description"),
        });
        return;
      }

      const needsReview = outcome?.tier === "review";

      // An uncertain card is routed to the catch-all rather than to whichever
      // bin its (possibly wrong) identification implies. Setting a handful of
      // cards aside for a human beats confidently mis-sorting them, which is
      // silent and only discovered much later.
      const ruleBin = evaluateCardBin(
        card,
        binConfigsRef.current,
        fieldDefinitionsRef.current,
      );
      const matchedBin = needsReview
        ? getCatchAllBin(binConfigsRef.current)
        : ruleBin;

      const record: ScannedCard = {
        scanId: generateScanId(),
        card,
        scannedAt: Date.now(),
        binNumber: matchedBin?.binNumber,
        capturedImageUrl,
        alternativeMatches: alternativeMatches?.length
          ? alternativeMatches
          : undefined,
        score: outcome?.score,
        margin: outcome?.margin,
        needsReview: needsReview || undefined,
      };

      setCards((prev) => [record, ...prev]);
      setTimerTrigger(record.scannedAt);
      addCollectionCard(collection.guid, record)
        .then((result) => {
          if (!result.success) {
            setCards((prev) => prev.filter((c) => c.scanId !== record.scanId));
            toast.error(t("scannedCards.collectionLocked.title"), {
              description: t("scannedCards.collectionLocked.description"),
            });
          }
        })
        .catch((err) => console.error("Failed to persist card:", err));

      if (
        matchedBin &&
        serialRef.current.isConnected &&
        serialRef.current.isReady
      ) {
        serialRef.current.sendBin(matchedBin.binNumber).then((response) => {
          if (!response) {
            toast.error(t("scannedCards.routingFailed.title"), {
              description: t("scannedCards.routingFailed.description", {
                binNumber: matchedBin.binNumber,
              }),
            });
            void reportSerialEvent({
              command: "bin",
              sent: true,
              response: null,
              cardName: card.name,
              binNumber: matchedBin.binNumber,
            });
            autoFeedRef.current = false;
            setAutoFeedState(false);
            return;
          }
          const res = response as Record<string, unknown>;
          if (res.empty) {
            toast.error(t("scannedCards.feederEmpty.title"), {
              description: t("scannedCards.feederEmpty.description"),
              duration: Infinity,
              dismissible: true,
            });
            void reportSerialEvent({
              command: "bin",
              sent: true,
              response: res,
              cardName: card.name,
              binNumber: matchedBin.binNumber,
            });
            autoFeedRef.current = false;
            setAutoFeedState(false);
            pauseHookRef.current?.();
            return;
          }
          if (res.error) {
            toast.error(t("scannedCards.sorterError.title"), {
              description: String(res.error),
              duration: Infinity,
              dismissible: true,
            });
            void reportSerialEvent({
              command: "bin",
              sent: true,
              response: res,
              cardName: card.name,
              binNumber: matchedBin.binNumber,
            });
            autoFeedRef.current = false;
            setAutoFeedState(false);
            return;
          }
          if (autoFeedRef.current) {
            triggerAutoFeed();
          }
        });
      }
    },
    [triggerAutoFeed, t],
  );

  const sendCatchAllBin = useCallback(() => {
    const catchAll = getCatchAllBin(binConfigsRef.current);
    if (
      catchAll &&
      serialRef.current.isConnected &&
      serialRef.current.isReady
    ) {
      serialRef.current.sendBin(catchAll.binNumber).then((response) => {
        if (!response) {
          toast.error(t("scannedCards.routingFailedCatchAll.title"), {
            description: t("scannedCards.routingFailedCatchAll.description", {
              binNumber: catchAll.binNumber,
            }),
          });
          void reportSerialEvent({
            command: "bin",
            sent: true,
            response: null,
            binNumber: catchAll.binNumber,
          });
          autoFeedRef.current = false;
          setAutoFeedState(false);
          return;
        }
        const res = response as Record<string, unknown>;
        if (res.empty) {
          toast.error(t("scannedCards.feederEmpty.title"), {
            description: t("scannedCards.feederEmpty.description"),
            duration: Infinity,
            dismissible: true,
          });
          void reportSerialEvent({
            command: "bin",
            sent: true,
            response: res,
            binNumber: catchAll.binNumber,
          });
          autoFeedRef.current = false;
          setAutoFeedState(false);
          pauseHookRef.current?.();
          return;
        }
        if (res.error) {
          toast.error(t("scannedCards.sorterError.title"), {
            description: String(res.error),
            duration: Infinity,
            dismissible: true,
          });
          void reportSerialEvent({
            command: "bin",
            sent: true,
            response: res,
            binNumber: catchAll.binNumber,
          });
          autoFeedRef.current = false;
          setAutoFeedState(false);
          return;
        }
        if (autoFeedRef.current) {
          triggerAutoFeed();
        }
      });
    }
  }, [triggerAutoFeed, t]);

  const removeCard = useCallback((scanId: string) => {
    const collection = activeCollectionRef.current;
    setCards((prev) => prev.filter((entry) => entry.scanId !== scanId));
    if (collection) {
      removeCollectionCard(collection.guid, scanId).catch((err) =>
        console.error("Failed to remove card:", err),
      );
    }
  }, []);

  const removeCards = useCallback((scanIds: string[]) => {
    const collection = activeCollectionRef.current;
    const idSet = new Set(scanIds);
    setCards((prev) => prev.filter((entry) => !idSet.has(entry.scanId)));
    if (collection) {
      removeCollectionCards(collection.guid, scanIds).catch((err) =>
        console.error("Failed to remove cards:", err),
      );
    }
  }, []);

  const correctCard = useCallback((scanId: string, card: PlayingCard) => {
    const collection = activeCollectionRef.current;
    const corrected: PlayingCardWithDistance = { ...card, distance: 0 };
    const matchedBin = evaluateCardBin(
      corrected,
      binConfigsRef.current,
      fieldDefinitionsRef.current,
    );

    // Capture what the pipeline had originally decided before overwriting it.
    // Each correction is a labelled example of a wrong identification — the
    // cheapest eval data there is, and it used to be destroyed here (the row
    // was overwritten and distance reset to 0, erasing the evidence).
    const previous = cardsRef.current.find((entry) => entry.scanId === scanId);
    const provenance = previous?.wasCorrected
      ? {} // already recorded; don't overwrite with the last correction
      : {
          originalCardId: previous?.card.id,
          originalDistance: previous?.card.distance,
          originalScore: previous?.score,
          wasCorrected: true,
        };

    setCards((prev) =>
      prev.map((entry) =>
        entry.scanId === scanId
          ? {
              ...entry,
              ...provenance,
              card: corrected,
              binNumber: matchedBin?.binNumber,
              needsReview: undefined,
            }
          : entry,
      ),
    );
    if (collection) {
      updateCollectionCard(
        collection.guid,
        scanId,
        corrected,
        matchedBin?.binNumber,
        provenance,
      ).catch((err) => console.error("Failed to update card:", err));
    }
  }, []);

  const toggleFoil = useCallback((scanId: string, isFoil: boolean) => {
    const collection = activeCollectionRef.current;
    setCards((prev) =>
      prev.map((entry) =>
        entry.scanId === scanId ? { ...entry, isFoil } : entry,
      ),
    );
    if (collection) {
      setCollectionCardFoil(collection.guid, scanId, isFoil).catch((err) =>
        console.error("Failed to update foil status:", err),
      );
    }
  }, []);

  const markDownloaded = useCallback((scanIds: string[]) => {
    const collection = activeCollectionRef.current;
    if (scanIds.length === 0) return;
    const idSet = new Set(scanIds);
    setCards((prev) =>
      prev.map((entry) =>
        idSet.has(entry.scanId) ? { ...entry, isDownloaded: true } : entry,
      ),
    );
    if (collection) {
      markCollectionCardsDownloaded(collection.guid, scanIds).catch((err) =>
        console.error("Failed to mark cards downloaded:", err),
      );
    }
  }, []);

  const clearCards = useCallback(() => {
    const collection = activeCollectionRef.current;
    setCards([]);
    setTimerTrigger(undefined);
    setTimerResetSignal((s) => s + 1);
    if (collection) {
      clearCollectionCards(collection.guid).catch((err) =>
        console.error("Failed to clear cards:", err),
      );
    }
  }, []);

  return (
    <ScannedCardsContext
      value={{
        cards,
        isLoading,
        autoFeed,
        elapsedMs,
        isTimerActive,
        setAutoFeed,
        registerCardArrivedHook,
        registerPauseHook,
        addCard,
        sendCatchAllBin,
        removeCard,
        removeCards,
        correctCard,
        toggleFoil,
        markDownloaded,
        clearCards,
      }}
    >
      {children}
    </ScannedCardsContext>
  );
}

export function useScannedCards() {
  const context = useContext(ScannedCardsContext);
  if (!context) {
    throw new Error(
      "useScannedCards must be used within a ScannedCardsProvider",
    );
  }
  return context;
}
