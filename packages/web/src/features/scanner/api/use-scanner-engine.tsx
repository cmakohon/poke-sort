import { searchByImage } from "@/features/cards/api/card";
import { useCollections } from "@/features/collections/api/use-collections";
import { reportSerialEvent } from "@/features/notifications/api/notification-settings";
import { orgSettingsQueryOptions } from "@/features/settings/api/org-settings";
import { useOrg } from "@/hooks/use-org";
import { useCameraContext } from "@/features/scanner/api/use-camera";
import { useScannedCards } from "@/features/scanner/api/use-scanned-cards";
import { useSerial, useSerialMessage } from "@/features/scanner/api/use-serial";
import {
  CARD_SETTLE_DELAY_MS,
  SCANNABLE_STATUSES,
} from "@/features/scanner/constants";
import {
  canvasToBlob,
  extractCardImage,
  resolveCardContour,
} from "@/features/scanner/lib/card-detection";
import { playDingSound } from "@/features/scanner/lib/audio";
import type { ScannerEngineValue } from "@/features/scanner/types";
import { FAULT_TOAST_DURATION_MS } from "@/lib/toast";
import {
  DEFAULT_SCAN_REGION,
  type CardContour,
  type IdentifyTier,
  type PlayingCard,
  type PlayingCardWithDistance,
  type ScanOutcome,
  type ScannerStatus,
} from "@poke-sort/shared";
import { useQuery } from "@tanstack/react-query";
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

const CLOSE_MATCH_DELTA = 0.05;

async function searchCardImage(
  canvas: HTMLCanvasElement,
  contour?: CardContour | null,
  collectionGuid?: string,
): Promise<{
  card: PlayingCardWithDistance | null;
  alternativeMatches: PlayingCardWithDistance[];
  tier: IdentifyTier;
  score?: number;
  margin?: number;
  scanEventId?: string;
  debugImageUrl: string;
}> {
  const warpedCanvas = contour ? extractCardImage(canvas, contour) : canvas;
  const debugImageUrl = warpedCanvas.toDataURL("image/jpeg", 0.8);
  const blob = await canvasToBlob(warpedCanvas);
  const formData = new FormData();
  formData.append("image", blob, "card.jpg");
  if (collectionGuid) formData.append("collectionGuid", collectionGuid);

  const empty = {
    card: null,
    alternativeMatches: [],
    tier: "no-match" as IdentifyTier,
    debugImageUrl,
  };

  const { data } = await searchByImage(formData);
  if (!data || data.candidates.length === 0) return empty;

  // Candidates arrive already hydrated and already re-ranked by the server.
  //
  // They used to be re-fetched here one HTTP call per candidate, and any
  // candidate whose fetch failed was silently dropped — which quietly promoted
  // #2 to be the answer with no indication that it had happened.
  const hydrated = data.candidates
    .filter((candidate) => candidate.card !== null)
    .map((candidate) => ({
      ...(candidate.card as PlayingCard),
      distance: candidate.distance,
    }));

  if (hydrated.length === 0) return empty;

  const [card, ...rest] = hydrated;
  const alternativeMatches = rest.filter(
    (m) => m.distance - card.distance <= CLOSE_MATCH_DELTA,
  );

  return {
    card,
    alternativeMatches,
    tier: data.tier,
    score: data.candidates[0].score,
    margin: data.margin ?? undefined,
    scanEventId: data.scanEventId,
    debugImageUrl,
  };
}

const ScannerEngineContext = createContext<ScannerEngineValue | null>(null);

export function ScannerEngineProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useTranslation("scanner");
  const {
    stream,
    status: cameraStatus,
    errorMessage: cameraError,
    retryCamera,
  } = useCameraContext();
  const { request } = useSerial();
  const {
    addCard,
    sendCatchAllBin,
    sendReviewBin,
    setAutoFeed,
    registerCardArrivedHook,
    registerPauseHook,
  } = useScannedCards();
  const { activeCollection } = useCollections();
  const { activeOrg } = useOrg();
  const { data: orgSettingsData } = useQuery(
    orgSettingsQueryOptions(activeOrg?.id),
  );

  const scanRegion = orgSettingsData?.scanRegion ?? DEFAULT_SCAN_REGION;
  const scanRegionRef = useRef(scanRegion);
  scanRegionRef.current = scanRegion;
  const scanCorners = orgSettingsData?.scanCorners ?? null;
  const scanCornersRef = useRef(scanCorners);
  scanCornersRef.current = scanCorners;

  // Same ref pattern as the scan region: the settle timeout is armed inside a
  // callback, and a ref keeps a mid-session calibration change effective on
  // the very next card rather than after a remount.
  const settleDelay =
    orgSettingsData?.captureSettleDelayMs ?? CARD_SETTLE_DELAY_MS;
  const settleDelayRef = useRef(settleDelay);
  settleDelayRef.current = settleDelay;

  const activeCollectionGuidRef = useRef(activeCollection?.guid);
  activeCollectionGuidRef.current = activeCollection?.guid;

  const videoRef = useRef<HTMLVideoElement>(null);
  // Reused rather than allocated per card: a 1920x1080 buffer per scan adds up.
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const statusRef = useRef<ScannerStatus>("initializing");
  const lastScannedCardIdRef = useRef<string | null>(null);
  const isCapturingRef = useRef(false);
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchResultsRef = useRef<
    (
      matches: PlayingCardWithDistance[],
      capturedImageUrl?: string,
      outcome?: ScanOutcome,
    ) => void
  >(() => {});
  const onNoMatchRef = useRef<() => void>(() => {});
  const handleErrorRef = useRef<(msg: string) => void>(() => {});

  const [status, setStatus] = useState<ScannerStatus>("initializing");
  const [errorMessage, setErrorMessage] = useState("");
  const [duplicateCard, setDuplicateCard] =
    useState<PlayingCardWithDistance | null>(null);
  const [debugImageUrl, setDebugImageUrl] = useState<string | null>(null);
  const debugImageUrlRef = useRef<string | null>(null);
  const [allowDuplicates, setAllowDuplicates] = useState(true);
  const [videoSize, setVideoSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [isFeeding, setIsFeeding] = useState(false);
  const [isClearingDevice, setIsClearingDevice] = useState(false);

  const updateStatus = useCallback((newStatus: ScannerStatus) => {
    statusRef.current = newStatus;
    setStatus(newStatus);
  }, []);

  const handleError = useCallback(
    (msg: string) => {
      updateStatus("error");
      setErrorMessage(msg);
    },
    [updateStatus],
  );

  // cards[0] is the pipeline's answer, but it is only sorted automatically
  // when the outcome says "accept". A "review" outcome still records the
  // scan — so the identification can be corrected, and the correction kept
  // as an eval example — while routing the card to the catch-all instead of
  // acting on an identification the pipeline is not confident about.
  useEffect(() => {
    onSearchResultsRef.current = (cards, capturedImageUrl, outcome) => {
      if (cards.length > 0) {
        addCard(cards[0], capturedImageUrl, cards.slice(1), outcome);
      }
    };
  }, [addCard]);

  // A card nothing could be read off is the review case by definition, so it
  // goes to the review bin when the sort names one (the catch-all otherwise,
  // which is where it always went). A skipped duplicate below still uses the
  // catch-all — that one is a deliberate discard, not an uncertain read.
  useEffect(() => {
    onNoMatchRef.current = sendReviewBin;
  }, [sendReviewBin]);

  useEffect(() => {
    handleErrorRef.current = handleError;
  }, [handleError]);

  // Sync camera-level status/errors into scanner status
  useEffect(() => {
    if (cameraStatus === "requesting") {
      updateStatus("requesting-camera");
    } else if (cameraStatus === "error") {
      updateStatus("error");
      setErrorMessage(cameraError);
    } else if (cameraStatus === "idle") {
      updateStatus("initializing");
    }
    // 'ready' is handled by the stream attachment effect below
  }, [cameraStatus, cameraError, updateStatus]);

  /**
   * The current frame, drawn straight off the video.
   *
   * Capture used to read the preview canvas the display RAF loop painted,
   * which tied it to a component that only rendered on the scan screen. Going
   * to the video directly also removes the dependency on RAF having painted
   * recently.
   */
  const frameToCanvas = useCallback(
    (video: HTMLVideoElement): HTMLCanvasElement => {
      const canvas = (captureCanvasRef.current ??=
        document.createElement("canvas"));
      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      return canvas;
    },
    [],
  );

  const performCapture = useCallback(
    async (checkDuplicate: boolean, contour?: CardContour | null) => {
      const video = videoRef.current;
      // Below HAVE_CURRENT_DATA drawImage paints nothing, so there is no frame
      // to identify — the same bail-out the display canvas used to need.
      if (!video || video.readyState < video.HAVE_CURRENT_DATA) {
        isCapturingRef.current = false;
        updateStatus("scanning");
        return;
      }

      try {
        const {
          card,
          alternativeMatches,
          tier,
          score,
          margin,
          scanEventId,
          debugImageUrl,
        } = await searchCardImage(
          frameToCanvas(video),
          contour,
          activeCollectionGuidRef.current,
        );
        setDebugImageUrl(debugImageUrl);
        debugImageUrlRef.current = debugImageUrl;

        // "no-match" means the pipeline had candidates but none it would stand
        // behind — treat it the same as having found nothing.
        if (card && tier !== "no-match") {
          if (
            checkDuplicate &&
            !allowDuplicates &&
            lastScannedCardIdRef.current === card.id
          ) {
            setDuplicateCard(card);
            updateStatus("duplicate");
          } else {
            lastScannedCardIdRef.current = card.id;
            onSearchResultsRef.current?.(
              [card, ...alternativeMatches],
              debugImageUrl,
              { tier, score, margin, scanEventId },
            );
            updateStatus("scanning");
          }
        } else {
          playDingSound();
          onNoMatchRef.current?.();
          updateStatus("no-match");
        }
      } catch (err) {
        handleErrorRef.current(
          err instanceof Error ? err.message : t("scanEngine.searchFailed"),
        );
      } finally {
        isCapturingRef.current = false;
      }
    },
    [updateStatus, allowDuplicates, frameToCanvas, t],
  );

  // Attach the stream and publish the frame size the preview lays itself out
  // against. Re-runs if the stream is replaced (e.g. after retryCamera).
  // Does NOT stop the stream tracks - the CameraProvider owns the stream
  // lifetime.
  useEffect(() => {
    if (!stream) return;

    let cancelled = false;
    const video = videoRef.current;
    if (!video) return;

    updateStatus("initializing");
    video.srcObject = stream;

    (async () => {
      try {
        await video.play();
        if (cancelled) return;

        setVideoSize({ width: video.videoWidth, height: video.videoHeight });
        updateStatus("paused");
      } catch (err) {
        if (!cancelled) {
          handleErrorRef.current(
            err instanceof Error ? err.message : t("scanEngine.videoStartFailed"),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      if (settleTimeoutRef.current) {
        clearTimeout(settleTimeoutRef.current);
        settleTimeoutRef.current = null;
        isCapturingRef.current = false;
      }
      video.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  const handleForceAddDuplicate = useCallback(() => {
    if (duplicateCard) {
      onSearchResultsRef.current?.(
        [duplicateCard],
        debugImageUrlRef.current ?? undefined,
        { tier: "accept" },
      );
      setDuplicateCard(null);
      updateStatus("scanning");
    }
  }, [duplicateCard, updateStatus]);

  const handleForceScan = useCallback(() => {
    if (
      isCapturingRef.current ||
      !SCANNABLE_STATUSES.includes(statusRef.current)
    )
      return;

    const video = videoRef.current;
    if (!video?.videoWidth) return;

    isCapturingRef.current = true;
    updateStatus("searching");
    setDuplicateCard(null);
    performCapture(
      false,
      resolveCardContour(
        video.videoWidth,
        video.videoHeight,
        scanCornersRef.current,
        scanRegionRef.current,
      ),
    );
  }, [updateStatus, performCapture]);

  const captureCard = useCallback(() => {
    if (
      isCapturingRef.current ||
      !SCANNABLE_STATUSES.includes(statusRef.current)
    )
      return;

    const video = videoRef.current;
    if (!video?.videoWidth) return;

    isCapturingRef.current = true;
    updateStatus("searching");
    const contour = resolveCardContour(
      video.videoWidth,
      video.videoHeight,
      scanCornersRef.current,
      scanRegionRef.current,
    );
    settleTimeoutRef.current = setTimeout(() => {
      settleTimeoutRef.current = null;
      performCapture(true, contour);
    }, settleDelayRef.current);
  }, [updateStatus, performCapture]);

  const handlePause = useCallback(() => {
    setDuplicateCard(null);
    updateStatus("paused");
  }, [updateStatus]);

  const handleResume = useCallback(() => {
    updateStatus("scanning");
  }, [updateStatus]);

  const handleRetryError = useCallback(async () => {
    setErrorMessage("");
    try {
      await retryCamera();
    } catch {
      handleErrorRef.current(t("scanEngine.cameraReinitFailed"));
    }
  }, [retryCamera, t]);

  const handleSkipDuplicate = useCallback(() => {
    sendCatchAllBin();
    setDuplicateCard(null);
    updateStatus("scanning");
  }, [sendCatchAllBin, updateStatus]);

  useSerialMessage((msg) => {
    if (
      typeof msg === "object" &&
      msg !== null &&
      "error" in msg &&
      (msg as Record<string, unknown>).error === "jam"
    ) {
      const raw = msg as Record<string, unknown>;

      if (
        raw.module === 1 &&
        raw.bin === undefined &&
        SCANNABLE_STATUSES.includes(statusRef.current)
      ) {
        toast.info(t("cardScanner.jamAutoScan.title"), {
          description: t("cardScanner.jamAutoScan.description"),
        });
        handleForceScan();
        return;
      }

      handlePause();
      toast.error(t("cardScanner.jamDetected.title"), {
        description: raw.bin
          ? t("cardScanner.jamDetected.descriptionWithBin", {
              module: raw.module,
              bin: raw.bin,
            })
          : t("cardScanner.jamDetected.description", { module: raw.module }),
        duration: FAULT_TOAST_DURATION_MS,
        dismissible: true,
      });
      void reportSerialEvent({ command: "jam", sent: true, response: raw });
    }
  });

  const handleFeed = useCallback(async () => {
    setIsFeeding(true);
    try {
      const { sent, response } = await request(
        JSON.stringify({ feeder: true }),
        10000,
      );
      if (!sent) {
        toast.error(t("cardScanner.feedFailed.title"), {
          description: t("cardScanner.feedFailed.description"),
        });
        void reportSerialEvent({
          command: "feeder",
          sent: false,
          response: null,
        });
        return;
      }
      if (!response) {
        toast.error(t("cardScanner.feedTimeout.title"), {
          description: t("cardScanner.feedTimeout.description"),
        });
        void reportSerialEvent({
          command: "feeder",
          sent: true,
          response: null,
        });
        return;
      }
      try {
        const parsed = JSON.parse(response) as Record<string, unknown>;
        if (parsed.empty) {
          handlePause();
          toast.error(t("cardScanner.feederEmpty.title"), {
            description: t("cardScanner.feederEmpty.description"),
            duration: FAULT_TOAST_DURATION_MS,
            dismissible: true,
          });
          void reportSerialEvent({
            command: "feeder",
            sent: true,
            response: parsed,
          });
        } else if (parsed.error) {
          toast.error(t("cardScanner.feederError.title"), {
            description: String(parsed.error),
            duration: FAULT_TOAST_DURATION_MS,
            dismissible: true,
          });
          void reportSerialEvent({
            command: "feeder",
            sent: true,
            response: parsed,
          });
        } else {
          // Feeder confirmed a card reached module 1 - capture it now.
          captureCard();
        }
      } catch {
        toast.error(t("cardScanner.feedError.title"), {
          description: t("cardScanner.feedError.description"),
        });
        void reportSerialEvent({ command: "feeder", sent: true, response });
      }
    } finally {
      setIsFeeding(false);
    }
  }, [request, captureCard, handlePause, t]);

  const handleClearDevice = useCallback(async () => {
    setIsClearingDevice(true);
    try {
      const { sent, response } = await request(
        JSON.stringify({ clearDevice: true }),
        10000,
      );
      if (!sent) {
        toast.error(t("cardScanner.clearFailed.title"), {
          description: t("cardScanner.clearFailed.description"),
        });
        return;
      }
      if (!response) {
        toast.error(t("cardScanner.clearTimeout.title"), {
          description: t("cardScanner.clearTimeout.description"),
        });
        return;
      }
      toast.success(t("cardScanner.deviceCleared.title"), {
        description: t("cardScanner.deviceCleared.description"),
      });
    } finally {
      setIsClearingDevice(false);
    }
  }, [request, t]);

  // The bare pause, deliberately: the feeder-empty path clears autofeed itself
  // before calling this, and a jam should not silently switch the run off.
  useEffect(() => {
    return registerPauseHook(handlePause);
  }, [registerPauseHook, handlePause]);

  useEffect(() => {
    return registerCardArrivedHook(captureCard);
  }, [registerCardArrivedHook, captureCard]);

  const isCameraActive = cameraStatus === "ready";
  const wasReadyRef = useRef(isCameraActive);
  useEffect(() => {
    if (!isCameraActive && wasReadyRef.current) {
      handlePause();
    }
    if (isCameraActive && !wasReadyRef.current && statusRef.current === "paused") {
      handleResume();
    }
    wasReadyRef.current = isCameraActive;
  }, [isCameraActive, handlePause, handleResume]);

  // Stopping the run is an operator decision, so it turns autofeed off too —
  // unlike the pause hook above, which only parks the scanner.
  const pauseRun = useCallback(() => {
    setAutoFeed(false);
    handlePause();
  }, [setAutoFeed, handlePause]);

  return (
    <ScannerEngineContext
      value={{
        status,
        errorMessage,
        duplicateCard,
        debugImageUrl,
        allowDuplicates,
        setAllowDuplicates,
        isCameraActive,
        isFeeding,
        isClearingDevice,
        videoRef,
        videoSize,
        scanRegion,
        scanCorners,
        handleForceScan,
        handleForceAddDuplicate,
        handleSkipDuplicate,
        handlePause: pauseRun,
        handleResume,
        handleRetryError,
        handleFeed,
        handleClearDevice,
      }}
    >
      <video ref={videoRef} className="hidden" playsInline muted />
      {children}
    </ScannerEngineContext>
  );
}

export function useScannerEngine() {
  const ctx = useContext(ScannerEngineContext);
  if (!ctx)
    throw new Error(
      "useScannerEngine must be used within a ScannerEngineProvider",
    );
  return ctx;
}
