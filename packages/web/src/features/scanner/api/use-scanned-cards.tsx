import {
  type BinConfig,
  type PlayingCard,
  type PlayingCardWithDistance,
  type ReviewCardSync,
  type ScanOutcome,
  type ScanSession,
  type ScannedCard,
  evaluateCardBin,
  getCatchAllBin,
  getReviewBin,
} from "@poke-sort/shared";

import { useBinConfigs } from "@/features/bins/api/use-bin-configs";
import { buildCorrection } from "@/features/cards/lib/apply-correction";
import { mergeReviewSync } from "@/features/cards/lib/apply-review-sync";
import {
  markCollectionCardsDownloaded,
  releaseScanLock,
  removeCollectionCard,
  removeCollectionCards,
  setCollectionCardFoil,
  updateCollectionCard,
} from "@/features/collections/api/collections";
import {
  addSessionCard,
  commitScanSession,
  discardScanSession,
  getOpenScanSession,
  openScanSession,
  retargetScanSession,
} from "@/features/scanner/api/scan-sessions";
import { useCollectionLocks } from "@/features/collections/api/use-collection-locks";
import { useCollections } from "@/features/collections/api/use-collections";
import { reportSerialEvent } from "@/features/notifications/api/notification-settings";
import { useScanTimer } from "@/features/scanner/api/use-scan-timer";
import { useSerial } from "@/features/scanner/api/use-serial";
import type { ScannedCardsContextValue } from "@/features/scanner/types";
import { generateScanId } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
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
import { FAULT_TOAST_DURATION_MS } from "@/lib/toast";

const ScannedCardsContext = createContext<ScannedCardsContextValue | null>(
  null,
);

/** The server's own words for a failed close, or null if it gave none. */
function failureReason(err: unknown): string | null {
  return err instanceof Error && err.message ? err.message : null;
}

export function ScannedCardsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useTranslation("scanner");
  const [cards, setCards] = useState<ScannedCard[]>([]);
  // The open run. Staged cards belong to it, not to a collection, until the
  // operator saves.
  const [session, setSession] = useState<ScanSession | null>(null);
  const sessionRef = useRef<ScanSession | null>(null);
  sessionRef.current = session;
  const [isClosingSession, setIsClosingSession] = useState(false);
  // Guards concurrent opens: several scans can land before the first POST
  // resolves, and all of them must await the same session.
  const openingRef = useRef<Promise<ScanSession | null> | null>(null);
  // correctCard needs the pre-correction record to preserve what the pipeline
  // originally predicted, and runs from a stable callback.
  const cardsRef = useRef<ScannedCard[]>(cards);
  cardsRef.current = cards;
  const [isLoading, setIsLoading] = useState(true);
  const { configs: binConfigs, fieldDefinitions } = useBinConfigs();
  const { sendBin, request, isConnected, isReady } = useSerial();
  const { activeCollection, activateCollection } = useCollections();
  const queryClient = useQueryClient();

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
    request,
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
      request,
      isConnected,
      isReady,
    };
  }, [sendBin, request, isConnected, isReady]);

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

  // Review-screen verdicts update the card server-side; this list only
  // refetches on collection switch, so the verdict endpoint returns the
  // card's new state and the review screen patches it in here. A scanId
  // from another (non-active) collection simply matches nothing.
  const applyReviewSync = useCallback((sync: ReviewCardSync) => {
    setCards((prev) =>
      prev.map((c) => (c.scanId === sync.scanId ? mergeReviewSync(c, sync) : c)),
    );
  }, []);

  const triggerAutoFeed = useCallback(async () => {
    const { sent, response } = await serialRef.current.request(
      JSON.stringify({ feeder: true }),
      10000,
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
          duration: FAULT_TOAST_DURATION_MS,
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
          duration: FAULT_TOAST_DURATION_MS,
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

  // Switching collections re-points the open run rather than reloading the
  // list: the staged cards belong to the run, not to whichever collection is
  // selected, so they must survive the switch. Only the game/lang context and
  // the default save destination move.
  useEffect(() => {
    const prev = prevCollectionGuidRef.current;
    const next = activeCollection?.guid;
    if (prev && prev !== next) {
      releaseScanLock(prev).catch(() => {});
      const open = sessionRef.current;
      if (open && next && open.targetCollectionGuid !== next) {
        retargetScanSession(open.guid, next)
          .then((r) => {
            if (r.success && r.data) setSession(r.data);
          })
          .catch((err) => console.error("Failed to retarget session:", err));
      }
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

  // Resume, once on mount. An interrupted run is server-side state, so a
  // reload or an app restart picks it back up instead of losing the cards.
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    getOpenScanSession()
      .then((open) => {
        if (cancelled || !open) return;
        setSession(open.session);
        setCards(open.cards);
        // Snap the switcher to the run's target so the bin rules, the game and
        // the identify language all follow the run being resumed rather than
        // whatever was last selected on this device.
        const target = open.session.targetCollectionGuid;
        if (target && target !== activeCollectionRef.current?.guid) {
          void activateCollection(target);
        }
      })
      .catch((err) => {
        if (!cancelled) console.error("Failed to resume scan session:", err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * The run a scan belongs to, opening one on the first scan.
   *
   * Concurrent callers share a single in-flight request: autofeed can fire
   * several scans before the first open resolves, and each must stage against
   * the same session rather than racing to create its own.
   */
  const ensureSession = useCallback(async (): Promise<ScanSession | null> => {
    const targetGuid = activeCollectionRef.current?.guid;

    const open = sessionRef.current;
    if (open) {
      // A run whose target collection was deleted mid-scan survives, but it
      // cannot identify anything until it is pointed somewhere. Re-aim it at
      // whatever is selected now rather than making the operator find a
      // "repair" button.
      if (!open.targetCollectionGuid && targetGuid) {
        const r = await retargetScanSession(open.guid, targetGuid).catch(
          (err) => {
            console.error("Failed to retarget session:", err);
            return null;
          },
        );
        if (r?.success && r.data) {
          setSession(r.data);
          sessionRef.current = r.data;
          return r.data;
        }
        return null;
      }
      return open;
    }
    if (openingRef.current) return openingRef.current;

    if (!targetGuid) return null;

    const pending = openScanSession(targetGuid)
      .then((r) => {
        if (!r.success || !r.data) return null;
        setSession(r.data.session);
        sessionRef.current = r.data.session;
        return r.data.session;
      })
      .catch((err) => {
        console.error("Failed to open scan session:", err);
        return null;
      })
      .finally(() => {
        openingRef.current = null;
      });

    openingRef.current = pending;
    return pending;
  }, []);

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

      // An uncertain card is set aside rather than routed to whichever bin its
      // (possibly wrong) identification implies. Setting a handful of cards
      // aside for a human beats confidently mis-sorting them, which is silent
      // and only discovered much later.
      //
      // "Aside" is the dedicated review bin when the sort names one, and the
      // catch-all otherwise — which is where every uncertain card used to go,
      // mixed in with the cards no rule claimed. Keeping them apart is what
      // makes the review stack worth carrying to a desk.
      const ruleBin = evaluateCardBin(
        card,
        binConfigsRef.current,
        fieldDefinitionsRef.current,
      );
      const matchedBin = needsReview
        ? getReviewBin(binConfigsRef.current)
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
        scanEventId: outcome?.scanEventId,
      };

      setCards((prev) => [record, ...prev]);
      setTimerTrigger(record.scannedAt);
      // Staged against the run, not written to the collection: nothing lands
      // in a collection until the operator saves.
      ensureSession()
        .then((open) => {
          if (!open) {
            setCards((prev) => prev.filter((c) => c.scanId !== record.scanId));
            toast.error(t("scannedCards.noCollectionSelected.title"), {
              description: t("scannedCards.noCollectionSelected.description"),
            });
            return null;
          }
          return addSessionCard(open.guid, record);
        })
        .then((result) => {
          if (!result || result.success) return;
          setCards((prev) => prev.filter((c) => c.scanId !== record.scanId));
          // Two different failures reach here. A 423 means someone else holds
          // the collection; a 409 means the run was saved or discarded while
          // this scan was in flight — the race the in-transaction re-check
          // exists for. Diagnosing the second as the first sends the operator
          // looking for another user who isn't there, for a card the machine
          // has already routed into a bin.
          const closed = result.message === "session_closed";
          toast.error(
            closed
              ? t("scannedCards.sessionClosedMidScan.title")
              : t("scannedCards.collectionLocked.title"),
            {
              description: closed
                ? t("scannedCards.sessionClosedMidScan.description")
                : t("scannedCards.collectionLocked.description"),
            },
          );
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
              duration: FAULT_TOAST_DURATION_MS,
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
              duration: FAULT_TOAST_DURATION_MS,
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
    [triggerAutoFeed, ensureSession, t],
  );

  // Routes a card the app is NOT recording to a fixed bin: nothing was
  // identified, or a duplicate is being skipped. No scan row, no rules — just
  // get the card out of module 1 and keep the feeder cycling.
  //
  // Parameterised because there are now two such bins. A card that could not be
  // read is a review case, while a skipped duplicate is not; before the review
  // bin existed both meant "catch-all" and the distinction had nowhere to go.
  const sendFixedBin = useCallback(
    (bin: BinConfig | undefined, failureDescriptionKey: string) => {
      if (!bin || !serialRef.current.isConnected || !serialRef.current.isReady) {
        return;
      }
      serialRef.current.sendBin(bin.binNumber).then((response) => {
        if (!response) {
          toast.error(t("scannedCards.routingFailedCatchAll.title"), {
            description: t(failureDescriptionKey, {
              binNumber: bin.binNumber,
            }),
          });
          void reportSerialEvent({
            command: "bin",
            sent: true,
            response: null,
            binNumber: bin.binNumber,
          });
          autoFeedRef.current = false;
          setAutoFeedState(false);
          return;
        }
        const res = response as Record<string, unknown>;
        if (res.empty) {
          toast.error(t("scannedCards.feederEmpty.title"), {
            description: t("scannedCards.feederEmpty.description"),
            duration: FAULT_TOAST_DURATION_MS,
            dismissible: true,
          });
          void reportSerialEvent({
            command: "bin",
            sent: true,
            response: res,
            binNumber: bin.binNumber,
          });
          autoFeedRef.current = false;
          setAutoFeedState(false);
          pauseHookRef.current?.();
          return;
        }
        if (res.error) {
          toast.error(t("scannedCards.sorterError.title"), {
            description: String(res.error),
            duration: FAULT_TOAST_DURATION_MS,
            dismissible: true,
          });
          void reportSerialEvent({
            command: "bin",
            sent: true,
            response: res,
            binNumber: bin.binNumber,
          });
          autoFeedRef.current = false;
          setAutoFeedState(false);
          return;
        }
        if (autoFeedRef.current) {
          triggerAutoFeed();
        }
      });
    },
    [triggerAutoFeed, t],
  );

  const sendCatchAllBin = useCallback(
    () =>
      sendFixedBin(
        getCatchAllBin(binConfigsRef.current),
        "scannedCards.routingFailedCatchAll.description",
      ),
    [sendFixedBin],
  );

  const sendReviewBin = useCallback(
    () =>
      sendFixedBin(
        getReviewBin(binConfigsRef.current),
        "scannedCards.routingFailedReview.description",
      ),
    [sendFixedBin],
  );

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
    const previous = cardsRef.current.find((entry) => entry.scanId === scanId);
    const { corrected, binNumber, provenance } = buildCorrection(
      previous,
      card,
      binConfigsRef.current,
      fieldDefinitionsRef.current,
    );

    setCards((prev) =>
      prev.map((entry) =>
        entry.scanId === scanId
          ? {
              ...entry,
              ...provenance,
              card: corrected,
              binNumber,
              needsReview: undefined,
            }
          : entry,
      ),
    );
    // The server keys on scanId + orgId; the collection guid is only the SSE
    // channel, so this works the same for a staged card as for a saved one.
    if (collection) {
      updateCollectionCard(
        collection.guid,
        scanId,
        corrected,
        binNumber,
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

  /** Local reset shared by both ways a run ends. */
  const resetSessionState = useCallback(() => {
    setCards([]);
    setSession(null);
    sessionRef.current = null;
    setTimerTrigger(undefined);
    setTimerResetSignal((s) => s + 1);
  }, []);

  // Both of these report whether the run actually closed. The caller needs to
  // know: dismissing the dialog on a failed save or discard tells the operator
  // the cards were dealt with when they are still staged on the server.
  const saveSession = useCallback(
    async (collectionGuid: string): Promise<boolean> => {
      const open = sessionRef.current;
      if (!open) return false;
      setIsClosingSession(true);
      try {
        const result = await commitScanSession(open.guid, collectionGuid);
        if (!result.success) throw new Error(result.message ?? "commit failed");
        resetSessionState();
        // Card counts moved between collections, and the destination's card
        // list is now stale.
        void queryClient.invalidateQueries({ queryKey: ["collections"] });
        void queryClient.invalidateQueries({
          queryKey: ["collection-cards", collectionGuid],
        });
        return true;
      } catch (err) {
        console.error("Failed to save scan session:", err);
        toast.error(t("scannedCards.saveSessionFailed.title"), {
          description: t("scannedCards.saveSessionFailed.description", {
            reason:
              failureReason(err) ?? t("scannedCards.saveSessionFailed.noReason"),
          }),
          duration: FAULT_TOAST_DURATION_MS,
        });
        return false;
      } finally {
        setIsClosingSession(false);
      }
    },
    [queryClient, resetSessionState, t],
  );

  const discardSession = useCallback(async (): Promise<boolean> => {
    const open = sessionRef.current;
    if (!open) {
      resetSessionState();
      return true;
    }
    setIsClosingSession(true);
    try {
      const result = await discardScanSession(open.guid);
      if (!result.success) throw new Error(result.message ?? "discard failed");
      resetSessionState();
      return true;
    } catch (err) {
      console.error("Failed to discard scan session:", err);
      toast.error(t("scannedCards.discardSessionFailed.title"), {
        description: t("scannedCards.discardSessionFailed.description", {
          reason:
            failureReason(err) ?? t("scannedCards.discardSessionFailed.noReason"),
        }),
        duration: FAULT_TOAST_DURATION_MS,
      });
      return false;
    } finally {
      setIsClosingSession(false);
    }
  }, [resetSessionState, t]);

  return (
    <ScannedCardsContext
      value={{
        cards,
        session,
        isLoading,
        autoFeed,
        elapsedMs,
        isTimerActive,
        setAutoFeed,
        registerCardArrivedHook,
        registerPauseHook,
        addCard,
        sendCatchAllBin,
        sendReviewBin,
        removeCard,
        removeCards,
        correctCard,
        toggleFoil,
        markDownloaded,
        saveSession,
        discardSession,
        isClosingSession,
        applyReviewSync,
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
