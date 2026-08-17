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
  const { isConnected, isReady, connect, disconnect, sendTest } = useSerial();
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

    // The camera is mounted sideways over the feeder, so the preview is always
    // rotated 90° in CSS and the cover-fit maths swaps the axes to match.
    const container = display.parentElement;
    if (container) {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const scale = Math.max(cw / height, ch / width);
      const cssW = Math.round(width * scale);
      const cssH = Math.round(height * scale);
      for (const canvas of [display, overlay]) {
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        canvas.style.left = `${(cw - cssW) / 2}px`;
        canvas.style.top = `${(ch - cssH) / 2}px`;
      }
    }

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

    return () => cancelAnimationFrame(raf);
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
      <div
        className={cn(
          "relative overflow-hidden bg-background w-full h-full max-w-full rounded-lg border",
          !compact && "md:aspect-[2.5/3.5]",
        )}
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
          onScannerRetry={sendTest}
          onCalibrate={() => navigate("/calibrate")}
          onAutoFeedChange={setAutoFeed}
          onAllowDuplicatesChange={setAllowDuplicates}
        />
      </div>
    </div>
  );
}
