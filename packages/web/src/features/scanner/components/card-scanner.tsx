import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBinConfigs } from "@/features/bins/api/use-bin-configs";
import { useCameraContext } from "@/features/scanner/api/use-camera";
import { useScannedCards } from "@/features/scanner/api/use-scanned-cards";
import { useScannerEngine } from "@/features/scanner/api/use-scanner-engine";
import { useSerial } from "@/features/scanner/api/use-serial";
import {
  drawDetectionOverlay,
  resolveCardContour,
} from "@/features/scanner/lib/card-detection";
import {
  DEFAULT_CAMERA_HEIGHT,
  DEFAULT_CAMERA_WIDTH,
} from "@/features/scanner/api/use-camera";
import { fitRotatedPreview } from "@/features/scanner/lib/preview-fit";
import { ScannerMenu } from "@/features/scanner/components/scanner-menu";
import { SerialPortPicker } from "@/features/scanner/components/serial-port-picker";
import { ScannerOverlay } from "@/features/scanner/components/scanner-overlay";
import { useRole } from "@/hooks/use-role";
import { cn } from "@/lib/utils";
import type { CardScannerProps } from "@poke-sort/shared";
import { IconEye } from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

/**
 * The scan screen's live preview.
 *
 * Purely a view: the capture loop, the feeder commands and the jam handling
 * all live in ScannerEngineProvider, above the router, so a run keeps going
 * when the operator navigates away from this screen. What is left here is the
 * canvas the operator watches, which is worth stopping when nobody is looking.
 */
export function CardScanner({ className, compact }: CardScannerProps) {
  const { t } = useTranslation("scanner");
  const navigate = useNavigate();
  const { isAdmin } = useRole();
  const { autoFeed, setAutoFeed } = useScannedCards();
  const { isConnected, isReady, connect, disconnect, retryBootSequence } =
    useSerial();
  const { hasCatchAll } = useBinConfigs();
  const {
    zoom,
    zoomRange,
    cameras,
    selectedCameraId,
    setZoom,
    selectCamera,
    stopCamera,
  } = useCameraContext();
  const {
    status,
    errorMessage,
    isCameraActive,
    debugImageUrl,
    videoRef,
    videoSize,
    scanRegion,
    scanCorners,
    allowDuplicates,
    setAllowDuplicates,
    handleRetryError,
  } = useScannerEngine();

  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  // Rotated: the camera is mounted sideways, so the box is as tall as the
  // frame is wide. Falls back to the resolution use-camera asks getUserMedia
  // for, so the layout does not jump when the stream actually arrives.
  const previewAspect = videoSize
    ? `${videoSize.height} / ${videoSize.width}`
    : `${DEFAULT_CAMERA_HEIGHT} / ${DEFAULT_CAMERA_WIDTH}`;

  // Mirrors the engine's video onto the visible canvas, and outlines the region
  // capture crops to. Torn down with the screen — the sort does not depend on
  // it, so there is no reason to keep copying 1080p frames nobody is watching.
  useEffect(() => {
    const video = videoRef.current;
    const display = displayCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!video || !videoSize || !display || !overlay) return;

    const { width, height } = videoSize;
    for (const canvas of [display, overlay]) {
      canvas.width = width;
      canvas.height = height;
    }

    // Re-measured on every container resize, not just when the video changes.
    // Sizing once left the canvas laid out for whatever the container happened
    // to be at mount, so dragging the window moved the preview off-centre and
    // left a band of background down one side.
    const container = display.parentElement;
    const applyFit = () => {
      if (!container) return;
      const fit = fitRotatedPreview(
        { width: container.clientWidth, height: container.clientHeight },
        { width, height },
      );
      for (const canvas of [display, overlay]) {
        canvas.style.width = `${fit.cssW}px`;
        canvas.style.height = `${fit.cssH}px`;
        canvas.style.left = `${fit.left}px`;
        canvas.style.top = `${fit.top}px`;
      }
    };
    applyFit();
    const observer = container ? new ResizeObserver(applyFit) : null;
    if (container && observer) observer.observe(container);

    const overlayCtx = overlay.getContext("2d");
    if (overlayCtx) {
      overlayCtx.clearRect(0, 0, width, height);
      drawDetectionOverlay(overlayCtx, {
        detected: true,
        contour: resolveCardContour(width, height, scanCorners, scanRegion),
        confidence: 1,
      });
    }

    const displayCtx = display.getContext("2d");
    let raf = 0;
    const loop = () => {
      if (displayCtx && video.readyState >= video.HAVE_ENOUGH_DATA) {
        displayCtx.drawImage(video, 0, 0);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    videoRef,
    videoSize,
    scanCorners,
    scanRegion.coverage,
    scanRegion.offsetX,
    scanRegion.offsetY,
    scanRegion.rotation,
    compact,
  ]);

  return (
    <div
      className={cn(
        "flex flex-col-reverse md:flex-col overflow-hidden gap-2",
        className,
      )}
    >
      {/* The box takes the camera's own aspect ratio — swapped, since the
          preview is rotated 90°. That is what makes the fit exact: contain and
          cover agree when the ratios match, so the feed fills the box edge to
          edge with no letterboxing and nothing cropped, at any window size.
          A card-shaped box was neither, and showed a band of background beside
          the feed. */}
      <div
        className={cn(
          "relative overflow-hidden bg-background rounded-lg border",
          // Sized from the height and centred: the aspect ratio supplies the
          // width, so auto side margins are what keep it centred — and they
          // are also why the width cannot come from stretching, which would
          // fight the ratio.
          compact ? "w-full h-full" : "flex-1 min-h-0 w-auto max-w-full mx-auto",
        )}
        style={compact ? undefined : { aspectRatio: previewAspect }}
      >
        <canvas
          ref={displayCanvasRef}
          className="absolute rotate-90"
        />
        <canvas
          ref={overlayCanvasRef}
          className="absolute z-20 pointer-events-none rotate-90"
        />
        {isAdmin && debugImageUrl && (
          <Tooltip>
            <TooltipTrigger className="absolute top-2 left-2 z-30 flex items-center justify-center size-7 rounded-lg bg-background/70 text-foreground backdrop-blur-sm hover:bg-background/90 transition-colors">
              <IconEye size={16} />
            </TooltipTrigger>
            <TooltipContent
              side="right"
              className="bg-background text-foreground border border-border p-0 shadow-lg max-w-none"
            >
              <img
                src={debugImageUrl}
                alt={t("cardScanner.lastSearchImageAlt")}
                className="w-48"
              />
            </TooltipContent>
          </Tooltip>
        )}
        <ScannerOverlay
          status={status}
          errorMessage={errorMessage}
          isCameraActive={isCameraActive}
          isConnected={isConnected}
          isReady={isReady}
          hasCatchAll={hasCatchAll}
          onRetryError={handleRetryError}
        />
        <SerialPortPicker />
        <ScannerMenu
          isCameraActive={isCameraActive}
          isConnected={isConnected}
          autoFeed={autoFeed}
          allowDuplicates={allowDuplicates}
          zoom={zoom}
          zoomRange={zoomRange}
          cameras={cameras}
          selectedCameraId={selectedCameraId}
          onCameraConnect={handleRetryError}
          onCameraDisconnect={stopCamera}
          onCameraSelect={selectCamera}
          onZoomChange={setZoom}
          onScannerConnect={connect}
          onScannerDisconnect={disconnect}
          onScannerRetry={retryBootSequence}
          onCalibrate={() => navigate("/calibrate")}
          onAutoFeedChange={setAutoFeed}
          onAllowDuplicatesChange={setAllowDuplicates}
        />
      </div>
    </div>
  );
}
