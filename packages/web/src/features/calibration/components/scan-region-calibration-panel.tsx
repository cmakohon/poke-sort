import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  orgSettingsQueryOptions,
  saveOrgSettings,
} from "@/features/settings/api/org-settings";
import { useOrg } from "@/hooks/use-org";
import { useCameraContext } from "@/features/scanner/api/use-camera";
import { cornersFromScanRegion } from "@/features/scanner/lib/card-detection";
import {
  DEFAULT_SCAN_REGION,
  SCAN_CORNER_KEYS,
  type Point,
  type ScanCornerKey,
  type ScanCorners,
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

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function clampCorners(corners: ScanCorners): ScanCorners {
  const clamp = (p: Point) => ({ x: clamp01(p.x), y: clamp01(p.y) });
  return {
    topLeft: clamp(corners.topLeft),
    topRight: clamp(corners.topRight),
    bottomRight: clamp(corners.bottomRight),
    bottomLeft: clamp(corners.bottomLeft),
  };
}

// The preview draws the camera feed pre-rotated 90° CW into a portrait canvas,
// so the operator sees the card upright and drags corners where they look.
// Corners are stored in raw (landscape) frame fractions, because that is the
// space the capture canvas is in, so the two spaces are converted here and
// nowhere else. Raw -> preview is (1 - y, x); toRaw below is its inverse.
const toPreview = (p: Point): Point => ({ x: 1 - p.y, y: p.x });
const toRaw = (p: Point): Point => ({ x: p.y, y: 1 - p.x });

type DragState =
  | { type: "corner"; corner: ScanCornerKey }
  | { type: "move"; startPreviewX: number; startPreviewY: number; start: ScanCorners };

export function ScanRegionCalibrationPanel() {
  const { t } = useTranslation("calibration");
  const { activeOrg } = useOrg();
  const queryClient = useQueryClient();
  const queryOpts = orgSettingsQueryOptions(activeOrg?.id);
  const { data, isLoading } = useQuery(queryOpts);

  const [draft, setDraft] = useState<ScanCorners | null>(null);

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

  // An install that has never opened this editor has no quad, so seed one from
  // the legacy region — the same derivation capture uses — and the operator
  // starts from exactly the box they had before rather than a blank frame.
  // Needs the frame's aspect ratio, hence the wait for videoSize.
  const seeded =
    data?.scanCorners ??
    (videoSize
      ? cornersFromScanRegion(
          videoSize.width,
          videoSize.height,
          data?.scanRegion ?? DEFAULT_SCAN_REGION,
        )
      : null);
  const corners = draft ?? seeded;
  const cornersRef = useRef(corners);
  cornersRef.current = corners;

  const previewCorners =
    corners && SCAN_CORNER_KEYS.map((key) => toPreview(corners[key]));

  const dragStateRef = useRef<DragState | null>(null);

  /** Pointer position as a 0-1 fraction of the preview, in preview space. */
  const previewPoint = (e: ReactPointerEvent): Point | null => {
    const frame = frameRef.current;
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  const handleCornerPointerDown =
    (corner: ScanCornerKey) => (e: ReactPointerEvent<Element>) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStateRef.current = { type: "corner", corner };
    };

  const handleQuadPointerDown = (e: ReactPointerEvent<Element>) => {
    const at = previewPoint(e);
    if (!at || !cornersRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      type: "move",
      startPreviewX: at.x,
      startPreviewY: at.y,
      start: cornersRef.current,
    };
  };

  const handlePointerMove = (e: ReactPointerEvent<Element>) => {
    const drag = dragStateRef.current;
    const at = previewPoint(e);
    if (!drag || !at || !cornersRef.current) return;

    if (drag.type === "corner") {
      // Straight to the pointer rather than by a delta: a corner handle is
      // small and the operator is aiming it at a card corner they can see, so
      // following the cursor exactly is what they expect.
      setDraft(
        clampCorners({ ...cornersRef.current, [drag.corner]: toRaw(at) }),
      );
      return;
    }

    // Whole-quad move. Translating in preview space and converting each corner
    // back keeps the drag axis-aligned with what the operator sees; a raw-space
    // delta would come out turned 90°.
    const dx = at.x - drag.startPreviewX;
    const dy = at.y - drag.startPreviewY;
    const moved = SCAN_CORNER_KEYS.map((key) => {
      const p = toPreview(drag.start[key]);
      return { x: p.x + dx, y: p.y + dy };
    });

    // Pull the whole quad back off the edge rather than clamping corner by
    // corner: an independent clamp would flatten the shape against the frame
    // border, quietly undoing the alignment the operator just set.
    const pullBack = (values: number[]) => {
      const min = Math.min(...values);
      if (min < 0) return -min;
      const max = Math.max(...values);
      return max > 1 ? 1 - max : 0;
    };
    const adjX = pullBack(moved.map((p) => p.x));
    const adjY = pullBack(moved.map((p) => p.y));

    const [topLeft, topRight, bottomRight, bottomLeft] = moved.map((p) =>
      toRaw({ x: p.x + adjX, y: p.y + adjY }),
    );
    setDraft(clampCorners({ topLeft, topRight, bottomRight, bottomLeft }));
  };

  const handlePointerUp = () => {
    dragStateRef.current = null;
  };

  const saveMutation = useMutation({
    mutationFn: (next: ScanCorners) => saveOrgSettings({ scanCorners: next }),
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
            {previewCorners && (
              <div
                className="absolute inset-0 touch-none select-none"
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                {/* The quad itself. Percentage-unit viewBox so the corner
                    fractions are the coordinates, stretched to the frame with
                    preserveAspectRatio="none"; non-scaling-stroke keeps the
                    outline an even width despite that stretch. */}
                <svg
                  className="absolute inset-0 w-full h-full"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <polygon
                    points={previewCorners
                      .map((p) => `${p.x * 100},${p.y * 100}`)
                      .join(" ")}
                    className="fill-primary/10 stroke-primary cursor-move"
                    strokeWidth={4}
                    vectorEffect="non-scaling-stroke"
                    onPointerDown={handleQuadPointerDown}
                  />
                </svg>
                {/* Handles as elements rather than SVG circles: the viewBox
                    above is deliberately non-uniform, which would squash a
                    circle drawn inside it into an ellipse. */}
                {SCAN_CORNER_KEYS.map((key, i) => (
                  <button
                    key={key}
                    type="button"
                    aria-label={t(`scanRegionCalibrationPanel.corner.${key}`)}
                    className="absolute size-9 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none flex items-center justify-center"
                    style={{
                      left: `${previewCorners[i].x * 100}%`,
                      top: `${previewCorners[i].y * 100}%`,
                    }}
                    onPointerDown={handleCornerPointerDown(key)}
                  >
                    {/* Hit area is the 36px button; the dot is 20px. A corner
                        has to be placed on a card edge the operator can see,
                        so the grab target is bigger than the mark. */}
                    <span className="size-5 rounded-full bg-primary border-2 border-background" />
                  </button>
                ))}
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
            disabled={!videoSize}
            onClick={() =>
              videoSize &&
              setDraft(
                cornersFromScanRegion(
                  videoSize.width,
                  videoSize.height,
                  DEFAULT_SCAN_REGION,
                ),
              )
            }
            title={t("scanRegionCalibrationPanel.resetToDefault")}
          >
            <IconRotate size={14} />
            <span className="sr-only">
              {t("scanRegionCalibrationPanel.resetToDefault")}
            </span>
          </Button>
          <Button
            disabled={draft === null || saveMutation.isPending}
            onClick={() => draft && saveMutation.mutate(draft)}
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
            {data?.scanCorners
              ? t("scanRegionCalibrationPanel.savedCornersSummary", {
                  corners: SCAN_CORNER_KEYS.map((key) => {
                    const p = toPreview(data.scanCorners![key]);
                    return `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
                  }).join(" · "),
                })
              : t("scanRegionCalibrationPanel.savedNoCorners")}
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
