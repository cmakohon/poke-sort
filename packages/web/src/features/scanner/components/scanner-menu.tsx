import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ZoomRange } from "@/features/scanner/types";
import {
  IconAdjustments,
  IconCameraSpark,
  IconDeviceUsb,
  IconDeviceUsbFilled,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

interface ScannerMenuProps {
  isCameraActive: boolean;
  isConnected: boolean;
  autoFeed: boolean;
  allowDuplicates: boolean;
  zoom: number;
  zoomRange: ZoomRange | null;
  cameras: MediaDeviceInfo[];
  selectedCameraId: string | null;
  onCameraConnect: () => void;
  onCameraDisconnect: () => void;
  onCameraSelect: (deviceId: string) => void;
  onZoomChange: (value: number) => void;
  onScannerConnect: () => void;
  onScannerDisconnect: () => void;
  onScannerRetry: () => void;
  onCalibrate: () => void;
  onAutoFeedChange: (enabled: boolean) => void;
  onAllowDuplicatesChange: (enabled: boolean) => void;
}

export function ScannerMenu({
  isCameraActive,
  isConnected,
  autoFeed,
  allowDuplicates,
  zoom,
  zoomRange,
  cameras,
  selectedCameraId,
  onCameraConnect,
  onCameraDisconnect,
  onCameraSelect,
  onZoomChange,
  onScannerConnect,
  onScannerDisconnect,
  onScannerRetry,
  onCalibrate,
  onAutoFeedChange,
  onAllowDuplicatesChange,
}: ScannerMenuProps) {
  const { t } = useTranslation("scanner");
  return (
    <div className="absolute top-2 right-2 z-40">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size="icon" variant="secondary" />}
        >
          <IconAdjustments size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <IconCameraSpark />
              {t("scannerMenu.camera")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {isCameraActive ? (
                <>
                  {cameras.length > 1 && (
                    <>
                      {cameras.map((cam, i) => (
                        <DropdownMenuCheckboxItem
                          key={cam.deviceId}
                          checked={cam.deviceId === selectedCameraId}
                          onCheckedChange={() => onCameraSelect(cam.deviceId)}
                        >
                          {cam.label ||
                            t("scannerMenu.cameraFallbackLabel", {
                              index: i + 1,
                            })}
                        </DropdownMenuCheckboxItem>
                      ))}
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onClick={onCameraConnect}>
                    {t("scannerMenu.reconnect")}
                  </DropdownMenuItem>
                  {zoomRange && (
                    <>
                      <DropdownMenuSeparator />
                      <div
                        className="px-2 py-1.5 flex flex-col gap-1"
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <p className="text-xs text-muted-foreground">
                          {t("scannerMenu.zoom")}
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-4">
                            {zoomRange.min}
                          </span>
                          <input
                            type="range"
                            min={zoomRange.min}
                            max={zoomRange.max}
                            step={zoomRange.step}
                            value={zoom}
                            onChange={(e) =>
                              onZoomChange(Number(e.target.value))
                            }
                            className="flex-1 cursor-pointer accent-foreground"
                          />
                          <span className="text-xs text-muted-foreground w-4">
                            {zoomRange.max}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={onCameraDisconnect}
                  >
                    {t("scannerMenu.disconnect")}
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onClick={onCameraConnect}>
                  {t("scannerMenu.connect")}
                </DropdownMenuItem>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {isConnected ? <IconDeviceUsbFilled /> : <IconDeviceUsb />}
              {t("scannerMenu.scanner")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {isConnected ? (
                <>
                  <DropdownMenuCheckboxItem
                    checked={autoFeed}
                    onCheckedChange={onAutoFeedChange}
                  >
                    {t("scannerMenu.autoFeed")}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={allowDuplicates}
                    onCheckedChange={onAllowDuplicatesChange}
                  >
                    {t("scannerMenu.allowDuplicates")}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onCalibrate}>
                    {t("scannerMenu.calibrate")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onScannerRetry}>
                    {t("scannerMenu.retryConnection")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={onScannerDisconnect}
                  >
                    {t("scannerMenu.disconnect")}
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onClick={onScannerConnect}>
                  {t("scannerMenu.connect")}
                </DropdownMenuItem>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
