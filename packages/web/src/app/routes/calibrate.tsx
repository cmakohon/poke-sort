import { AuditDrawer, type AuditEntry } from "@/components/audit-drawer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  feederQueryOptions,
  getFeederHistory,
  revertFeederConfig,
  type FeederConfigAuditEntry,
} from "@/features/calibration/api/feeder-config";
import {
  getModuleHistory,
  modulesQueryOptions,
  revertModuleConfig,
  type ModuleConfigAuditEntry,
} from "@/features/calibration/api/module-configs";
import { useCalibrationPage } from "@/features/calibration/api/use-calibration-page";
import { BinRoutingControls } from "@/features/calibration/components/bin-routing-controls";
import { CalibrationTransfer } from "@/features/calibration/components/calibration-transfer";
import { FeederCalibrationPanel } from "@/features/calibration/components/feeder-calibration-panel";
import { IrSensorPanel } from "@/features/calibration/components/ir-sensor-panel";
import { LedControls } from "@/features/calibration/components/led-controls";
import { ModuleCalibrationGrid } from "@/features/calibration/components/module-calibration-grid";
import { ScanRegionCalibrationPanel } from "@/features/calibration/components/scan-region-calibration-panel";
import { IconClockHour3, IconDeviceUsb, IconDeviceUsbFilled } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

function ModuleHistoryBody({ entry }: { entry: ModuleConfigAuditEntry }) {
  const { t } = useTranslation("calibration");
  const { calibration: c } = entry;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex gap-2">
        <span className="w-24 shrink-0 text-muted-foreground">
          {t("calibratePage.moduleHistory.bottom")}
        </span>
        <span>
          {t("calibratePage.moduleHistory.closedOpen", {
            closed: c.bottomClosed,
            open: c.bottomOpen,
          })}
        </span>
      </div>
      <div className="flex gap-2">
        <span className="w-24 shrink-0 text-muted-foreground">
          {t("calibratePage.moduleHistory.paddle")}
        </span>
        <span>
          {t("calibratePage.moduleHistory.closedOpen", {
            closed: c.paddleClosed,
            open: c.paddleOpen,
          })}
        </span>
      </div>
      <div className="flex gap-2">
        <span className="w-24 shrink-0 text-muted-foreground">
          {t("calibratePage.moduleHistory.pusher")}
        </span>
        <span>
          {t("calibratePage.moduleHistory.leftNeutralRight", {
            left: c.pusherLeft,
            neutral: c.pusherNeutral,
            right: c.pusherRight,
          })}
        </span>
      </div>
    </div>
  );
}

function FeederHistoryBody({ entry }: { entry: FeederConfigAuditEntry }) {
  const { t } = useTranslation("calibration");
  const { calibration: c } = entry;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
      <span className="text-muted-foreground">{t("calibratePage.feederHistory.speed")}</span><span>{c.speed}</span>
      <span className="text-muted-foreground">{t("calibratePage.feederHistory.duration")}</span><span>{t("calibratePage.feederHistory.msValue", { value: c.duration })}</span>
      <span className="text-muted-foreground">{t("calibratePage.feederHistory.pulse")}</span><span>{c.pulseDuration <= 0 ? t("calibratePage.feederHistory.continuous") : t("calibratePage.feederHistory.msValue", { value: c.pulseDuration })}</span>
      <span className="text-muted-foreground">{t("calibratePage.feederHistory.pause")}</span><span>{t("calibratePage.feederHistory.msValue", { value: c.pauseDuration })}</span>
      <span className="text-muted-foreground">{t("calibratePage.feederHistory.settle")}</span><span>{t("calibratePage.feederHistory.msValue", { value: c.settleDuration })}</span>
    </div>
  );
}

export default function CalibratePage() {
  const { t } = useTranslation("calibration");
  const queryClient = useQueryClient();
  const [moduleHistoryOpen, setModuleHistoryOpen] = useState(false);
  const [feederHistoryOpen, setFeederHistoryOpen] = useState(false);

  const { data: moduleHistoryResult, isLoading: moduleHistoryLoading } = useQuery({
    queryKey: ["modules", "history"],
    queryFn: getModuleHistory,
    enabled: moduleHistoryOpen,
    staleTime: 0,
  });

  const { data: feederHistoryResult, isLoading: feederHistoryLoading } = useQuery({
    queryKey: ["feeder", "history"],
    queryFn: getFeederHistory,
    enabled: feederHistoryOpen,
    staleTime: 0,
  });

  const revertModuleMutation = useMutation({
    mutationFn: revertModuleConfig,
    onSuccess: (result) => {
      if (result.success && result.data) {
        queryClient.setQueryData(modulesQueryOptions.queryKey, result.data);
        queryClient.invalidateQueries({ queryKey: ["modules", "history"] });
        setModuleHistoryOpen(false);
        toast.success(t("calibratePage.toasts.moduleReverted"));
      }
    },
    onError: () => toast.error(t("calibratePage.toasts.revertFailed")),
  });

  const revertFeederMutation = useMutation({
    mutationFn: revertFeederConfig,
    onSuccess: (result) => {
      if (result.success && result.data) {
        queryClient.setQueryData(feederQueryOptions.queryKey, result.data);
        queryClient.invalidateQueries({ queryKey: ["feeder", "history"] });
        setFeederHistoryOpen(false);
        toast.success(t("calibratePage.toasts.feederReverted"));
      }
    },
    onError: () => toast.error(t("calibratePage.toasts.revertFailed")),
  });

  const moduleHistoryEntries = useMemo((): AuditEntry[] => {
    return (moduleHistoryResult?.data ?? []).map((entry: ModuleConfigAuditEntry) => ({
      guid: entry.guid,
      createdAt: entry.createdAt,
      label: t("calibratePage.moduleHistory.moduleLabel", {
        module: entry.moduleNumber,
      }),
      body: <ModuleHistoryBody entry={entry} />,
    }));
  }, [moduleHistoryResult, t]);

  const feederHistoryEntries = useMemo((): AuditEntry[] => {
    return (feederHistoryResult?.data ?? []).map((entry: FeederConfigAuditEntry) => ({
      guid: entry.guid,
      createdAt: entry.createdAt,
      label: t("calibratePage.feederHistory.entryLabel"),
      body: <FeederHistoryBody entry={entry} />,
    }));
  }, [feederHistoryResult, t]);

  const {
    isConnected,
    connect,
    disconnect,
    configs,
    isLoading,
    active,
    sliderValues,
    ledStates,
    activeBin,
    isTesting,
    isUnconfigured,
    handleControl,
    handleReset,
    handleSliderChange,
    handleLedToggle,
    handleTest,
    handleTestBin,
    handleCenterModule,
    handleSetPosition,
    feederConfig,
    feederSpeedValue,
    feederDurationValue,
    feederPulseDurationValue,
    feederPauseDurationValue,
    feederSettleDurationValue,
    handleFeederSpeedChange,
    handleFeederDurationChange,
    handleFeederPulseDurationChange,
    handleFeederPauseDurationChange,
    handleFeederSettleDurationChange,
    handleFeederSetSpeed,
    handleFeederSetDuration,
    handleFeederSetPulseDuration,
    handleFeederSetPauseDuration,
    handleFeederSetSettleDuration,
    handleFeed,
    isSampleRunning,
    handleSampleRun,
    irStates,
    hopperHasCards,
    irMonitoring,
    handleReadIR,
    handleToggleIrMonitor,
  } = useCalibrationPage();

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-bold font-heading">
          {t("calibratePage.title")}
        </h1>
        <p className="text-xs text-muted-foreground">
          {t("calibratePage.subtitle")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isConnected ? (
          <Button variant="outline" onClick={disconnect}>
            <IconDeviceUsbFilled />
            {t("calibratePage.disconnect")}
          </Button>
        ) : (
          <Button onClick={connect}>
            <IconDeviceUsb />
            {t("calibratePage.connectDevice")}
          </Button>
        )}
        <Button
          variant="outline"
          disabled={!isConnected || isTesting || isUnconfigured}
          onClick={handleTest}
        >
          {isTesting ? t("calibratePage.testing") : t("calibratePage.runTest")}
        </Button>
        {isUnconfigured && (
          <span className="text-xs text-muted-foreground">
            {t("calibratePage.calibrateBeforeTest")}
          </span>
        )}
        {/* Not gated on the USB link: moving a file between installs has
            nothing to do with whether a sorter is plugged in. */}
        <div className="ms-auto flex items-center gap-2">
          <CalibrationTransfer />
        </div>
      </div>

      <LedControls
        ledStates={ledStates}
        isConnected={isConnected}
        onToggle={handleLedToggle}
      />

      <IrSensorPanel
        irStates={irStates}
        hopperHasCards={hopperHasCards}
        isConnected={isConnected}
        isMonitoring={irMonitoring}
        onRead={handleReadIR}
        onToggleMonitor={handleToggleIrMonitor}
      />

      <BinRoutingControls
        activeBin={activeBin}
        isConnected={isConnected}
        isSampleRunning={isSampleRunning}
        onTestBin={handleTestBin}
        onFeed={handleFeed}
        onSampleRun={handleSampleRun}
      />

      <div className="flex flex-col gap-2">
        <Label>{t("calibratePage.scanRegionLabel")}</Label>
        <ScanRegionCalibrationPanel />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>{t("calibratePage.feederCalibrationLabel")}</Label>
          <button
            type="button"
            onClick={() => setFeederHistoryOpen(true)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <IconClockHour3 size={12} />
            {t("calibratePage.history")}
          </button>
        </div>
        <FeederCalibrationPanel
          speedValue={feederSpeedValue}
          durationValue={feederDurationValue}
          pulseDurationValue={feederPulseDurationValue}
          pauseDurationValue={feederPauseDurationValue}
          settleDurationValue={feederSettleDurationValue}
          calibration={feederConfig}
          isLoading={isLoading}
          isConnected={isConnected}
          onSpeedChange={handleFeederSpeedChange}
          onDurationChange={handleFeederDurationChange}
          onPulseDurationChange={handleFeederPulseDurationChange}
          onPauseDurationChange={handleFeederPauseDurationChange}
          onSettleDurationChange={handleFeederSettleDurationChange}
          onSetSpeed={handleFeederSetSpeed}
          onSetDuration={handleFeederSetDuration}
          onSetPulseDuration={handleFeederSetPulseDuration}
          onSetPauseDuration={handleFeederSetPauseDuration}
          onSetSettleDuration={handleFeederSetSettleDuration}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>{t("calibratePage.moduleCalibrationLabel")}</Label>
          <button
            type="button"
            onClick={() => setModuleHistoryOpen(true)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <IconClockHour3 size={12} />
            {t("calibratePage.history")}
          </button>
        </div>
        <ModuleCalibrationGrid
          configs={configs}
          active={active}
          sliderValues={sliderValues}
          isLoading={isLoading}
          isConnected={isConnected}
          onControl={handleControl}
          onReset={handleReset}
          onSliderChange={handleSliderChange}
          onSetPosition={handleSetPosition}
          onCenter={handleCenterModule}
        />
      </div>

      <AuditDrawer
        open={feederHistoryOpen}
        onOpenChange={setFeederHistoryOpen}
        title={t("calibratePage.feederHistoryTitle")}
        entries={feederHistoryEntries}
        isLoading={feederHistoryLoading}
        onRevert={(guid) => revertFeederMutation.mutate(guid)}
        isReverting={revertFeederMutation.isPending}
      />

      <AuditDrawer
        open={moduleHistoryOpen}
        onOpenChange={setModuleHistoryOpen}
        title={t("calibratePage.moduleHistoryTitle")}
        entries={moduleHistoryEntries}
        isLoading={moduleHistoryLoading}
        onRevert={(guid) => revertModuleMutation.mutate(guid)}
        isReverting={revertModuleMutation.isPending}
      />
    </div>
  );
}
