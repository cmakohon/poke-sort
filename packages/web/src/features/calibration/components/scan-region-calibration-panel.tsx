import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  orgSettingsQueryOptions,
  saveOrgSettings,
} from "@/features/settings/api/org-settings";
import { useOrg } from "@/hooks/use-org";
import { useCameraContext } from "@/features/scanner/api/use-camera";
import { getDefaultCardContour } from "@/features/scanner/lib/card-detection";
import {
  DEFAULT_SCAN_REGION,
  type CardContour,
  type ScanRegion,
} from "@poke-sort/shared";
import { IconCameraSpark, IconRotate } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";

function clampRegion(region: ScanRegion): ScanRegion {
  return {
    coverage: Math.min(1, Math.max(0.1, region.coverage)),
    offsetX: Math.min(0.45, Math.max(-0.45, region.offsetX)),
    offsetY: Math.min(0.45, Math.max(-0.45, region.offsetY)),
  };
}

// The live preview draws the camera feed pre-rotated 90° CW into a portrait
// canvas (same rotation extractCardImage applies when warping a captured
// card - see card-detection.ts), so the box the user drags matches what
// they see during real scanning without any CSS transform math. The scan
// region itself is still stored/consumed in raw (landscape) frame
// fractions - getDefaultCardContour always runs against the unrotated
// display canvas at capture time - so contour corners are re-projected into
// portrait fractions here purely for drawing the box each render.
function rawContourToPortraitBox(
  contour: CardContour,
  rawWidth: number,
  rawHeight: number,
) {
  const corners = [
    contour.topLeft,
    contour.topRight,
    contour.bottomRight,
    contour.bottomLeft,
  ];
  const portraitPoints = corners.map((p) => ({
    x: 1 - p.y / rawHeight,
    y: p.x / rawWidth,
  }));
  const xs = portraitPoints.map((p) => p.x);
  const ys = portraitPoints.map((p) => p.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

type DragState =
  | {
      type: "move";
      startClientX: number;
      startClientY: number;
      startOffsetX: number;
      startOffsetY: number;
    }
  | {
      type: "resize";
      centerClientX: number;
      centerClientY: number;
      startDist: number;
      startCoverage: number;
    };

export function ScanRegionCalibrationPanel() {
  const { t } = useTranslation("calibration");
  const { activeOrg } = useOrg();
  const queryClient = useQueryClient();
  const queryOpts = orgSettingsQueryOptions(activeOrg?.id);
  const { data, isLoading } = useQuery(queryOpts);
  const savedRegion = data?.scanRegion ?? DEFAULT_SCAN_REGION;

  const [draft, setDraft] = useState<ScanRegion | null>(null);
  const region = draft ?? savedRegion;
  const regionRef = useRef(region);
  regionRef.current = region;

  const {
    stream,
    status: cameraStatus,
    errorMessage,
    retryCamera,
  } = useCameraContext();
  const isCameraActive = cameraStatus === "ready";
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnectCamera = async () => {
    setIsConnecting(true);
    try {
      await retryCamera();
    } finally {
      setIsConnecting(false);
    }
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const [videoSize, setVideoSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    if (!stream) return;
    let cancelled = false;
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;

    (async () => {
      try {
        await video.play();
        if (cancelled) return;

        const { videoWidth, videoHeight } = video;
        setVideoSize({ width: videoWidth, height: videoHeight });

        const canvas = canvasRef.current;
        if (canvas) {
          // Portrait buffer - swapped vs the raw (landscape) video dims.
          canvas.width = videoHeight;
          canvas.height = videoWidth;
        }

        // Size/position the frame wrapper (not the canvas directly) so the
        // drag box, positioned as a percentage-based child of this same
        // wrapper, resolves against the canvas's actual displayed
        // rectangle instead of the outer (fixed card-aspect) container.
        const frame = frameRef.current;
        const container = frame?.parentElement;
        if (container && frame && canvas) {
          const cw = container.clientWidth;
          const ch = container.clientHeight;
          const scale = Math.max(cw / canvas.width, ch / canvas.height);
          const cssW = Math.round(canvas.width * scale);
          const cssH = Math.round(canvas.height * scale);
          frame.style.width = `${cssW}px`;
          frame.style.height = `${cssH}px`;
          frame.style.left = `${(cw - cssW) / 2}px`;
          frame.style.top = `${(ch - cssH) / 2}px`;
        }

        const loop = () => {
          const c = canvasRef.current;
          const ctx = c?.getContext("2d");
          if (c && ctx && video.readyState >= video.HAVE_ENOUGH_DATA) {
            ctx.save();
            ctx.translate(c.width / 2, c.height / 2);
            ctx.rotate(Math.PI / 2);
            ctx.drawImage(
              video,
              -videoWidth / 2,
              -videoHeight / 2,
              videoWidth,
              videoHeight,
            );
            ctx.restore();
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch {
        // useCameraContext surfaces failures via errorMessage/status
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      video.srcObject = null;
    };
  }, [stream]);

  const box = videoSize
    ? rawContourToPortraitBox(
        getDefaultCardContour(videoSize.width, videoSize.height, region),
        videoSize.width,
        videoSize.height,
      )
    : null;

  const dragStateRef = useRef<DragState | null>(null);

  const handleBoxPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      type: "move",
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffsetX: regionRef.current.offsetX,
      startOffsetY: regionRef.current.offsetY,
    };
  };

  const handleResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const frame = frameRef.current;
    if (!frame || !box) return;
    const rect = frame.getBoundingClientRect();
    const centerClientX = rect.left + (box.left + box.width / 2) * rect.width;
    const centerClientY = rect.top + (box.top + box.height / 2) * rect.height;
    dragStateRef.current = {
      type: "resize",
      centerClientX,
      centerClientY,
      startDist: Math.hypot(
        e.clientX - centerClientX,
        e.clientY - centerClientY,
      ),
      startCoverage: regionRef.current.coverage,
    };
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    const frame = frameRef.current;
    if (!drag || !frame) return;

    if (drag.type === "move") {
      const rect = frame.getBoundingClientRect();
      // Feed is drawn pre-rotated 90° CW, so a horizontal drag on screen
      // maps to the raw frame's vertical axis and vice versa.
      const dxFrac = (e.clientX - drag.startClientX) / rect.width;
      const dyFrac = (e.clientY - drag.startClientY) / rect.height;
      setDraft(
        clampRegion({
          ...regionRef.current,
          offsetX: drag.startOffsetX + dyFrac,
          offsetY: drag.startOffsetY - dxFrac,
        }),
      );
    } else {
      const dist = Math.hypot(
        e.clientX - drag.centerClientX,
        e.clientY - drag.centerClientY,
      );
      if (drag.startDist > 0) {
        setDraft(
          clampRegion({
            ...regionRef.current,
            coverage: drag.startCoverage * (dist / drag.startDist),
          }),
        );
      }
    }
  };

  const handlePointerUp = () => {
    dragStateRef.current = null;
  };

  const saveMutation = useMutation({
    mutationFn: (next: ScanRegion) => saveOrgSettings({ scanRegion: next }),
    onSuccess: (result) => {
      if (result.success && result.data) {
        queryClient.setQueryData(queryOpts.queryKey, result.data);
        setDraft(null);
      }
    },
  });

  // The capture settle delay: how long after the IR sensor confirms a card
  // the frame is taken. Draft-then-save like the region above it, because a
  // half-adjusted timing mid-feed is worse than the old timing.
  const savedDelay = data?.captureSettleDelayMs ?? 500;
  const [delayDraft, setDelayDraft] = useState<number | null>(null);
  const delay = delayDraft ?? savedDelay;
  const delayMutation = useMutation({
    mutationFn: (next: number) =>
      saveOrgSettings({ captureSettleDelayMs: next }),
    onSuccess: (result) => {
      if (result.success && result.data) {
        queryClient.setQueryData(queryOpts.queryKey, result.data);
        setDelayDraft(null);
      }
    },
  });
  const stepDelay = (d: number) =>
    setDelayDraft(Math.min(5000, Math.max(0, delay + d)));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {t("scanRegionCalibrationPanel.instructions")}
      </p>

      <div className="flex flex-col gap-2 w-full max-w-sm mx-auto md:mx-0">
        <Button
          variant="outline"
          onClick={handleConnectCamera}
          disabled={isConnecting}
          className="w-full"
        >
          <IconCameraSpark />
          {isConnecting
            ? t("scanRegionCalibrationPanel.connecting")
            : isCameraActive
              ? t("scanRegionCalibrationPanel.reconnectWebcam")
              : t("scanRegionCalibrationPanel.connectWebcam")}
        </Button>

        <div className="relative overflow-hidden bg-background w-full rounded-lg border aspect-[2.5/3.5]">
          <video ref={videoRef} className="hidden" playsInline muted />
          <div ref={frameRef} className="absolute">
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full"
            />
            {box && (
              <div
                className="absolute rounded-2xl border-[6px] border-primary cursor-move touch-none select-none"
                style={{
                  left: `${box.left * 100}%`,
                  top: `${box.top * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`,
                }}
                onPointerDown={handleBoxPointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                <div
                  className="absolute -right-2.5 -bottom-2.5 size-5 rounded-full bg-primary border-2 border-background cursor-nwse-resize touch-none"
                  onPointerDown={handleResizePointerDown}
                />
              </div>
            )}
          </div>
          {!isCameraActive && (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center">
              <p className="text-xs text-muted-foreground">
                {errorMessage || t("scanRegionCalibrationPanel.waitingForCamera")}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setDraft({ ...DEFAULT_SCAN_REGION })}
            title={t("scanRegionCalibrationPanel.resetToDefault")}
          >
            <IconRotate size={14} />
            <span className="sr-only">
              {t("scanRegionCalibrationPanel.resetToDefault")}
            </span>
          </Button>
          <Button
            disabled={draft === null || saveMutation.isPending}
            onClick={() => saveMutation.mutate(region)}
            className="flex-1"
          >
            {saveMutation.isPending
              ? t("scanRegionCalibrationPanel.saving")
              : t("scanRegionCalibrationPanel.saveScanRegion")}
          </Button>
        </div>
        {isLoading ? (
          <Skeleton className="h-3 w-40 rounded" />
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("scanRegionCalibrationPanel.savedSummary", {
              coverage: Math.round(savedRegion.coverage * 100),
              offsetX: Math.round(savedRegion.offsetX * 100),
              offsetY: Math.round(savedRegion.offsetY * 100),
            })}
          </p>
        )}

        <div className="flex flex-col gap-1.5 pt-2 border-t">
          <p className="text-[11px] font-medium text-muted-foreground tracking-wide font-heading">
            {t("scanRegionCalibrationPanel.settleDelayLabel")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("scanRegionCalibrationPanel.settleDelayHint")}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => stepDelay(-100)}>
              -100
            </Button>
            <Button variant="outline" size="sm" onClick={() => stepDelay(-25)}>
              -25
            </Button>
            <span className="flex-1 text-center text-sm font-medium tabular-nums">
              {t("scanRegionCalibrationPanel.msValue", { value: delay })}
            </span>
            <Button variant="outline" size="sm" onClick={() => stepDelay(25)}>
              +25
            </Button>
            <Button variant="outline" size="sm" onClick={() => stepDelay(100)}>
              +100
            </Button>
          </div>
          <Button
            size="sm"
            disabled={delayDraft === null || delayMutation.isPending}
            onClick={() => delayMutation.mutate(delay)}
          >
            {delayMutation.isPending
              ? t("scanRegionCalibrationPanel.saving")
              : t("scanRegionCalibrationPanel.saveSettleDelay")}
          </Button>
        </div>
      </div>
    </div>
  );
}
