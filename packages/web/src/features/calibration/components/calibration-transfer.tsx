import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getCalibrationDocument,
  importCalibrationDocument,
  type CalibrationDocument,
} from "@/features/calibration/api/calibration-document";
import { useFeederConfig } from "@/features/calibration/api/use-feeder-config";
import { useModuleConfigs } from "@/features/calibration/api/use-module-configs";
import { useSerial } from "@/features/scanner/api/use-serial";
import { downloadFile, fileDateSuffix } from "@/lib/download-file";
import { IconFileDownload, IconFileUpload } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

/** What a picked file will change, in the words the rest of the page uses. */
function useFileSummary(doc: Partial<CalibrationDocument> | null): string[] {
  const { t } = useTranslation("calibration");
  if (!doc) return [];

  const lines: string[] = [];
  const moduleCount = Array.isArray(doc.modules) ? doc.modules.length : 0;
  if (moduleCount > 0)
    lines.push(t("calibratePage.transfer.parts.modules", { count: moduleCount }));
  if (doc.feeder) lines.push(t("calibratePage.transfer.parts.feeder"));
  // Absent means "leave alone", null means "clear" — the two read very
  // differently to someone about to apply the file, so they are not merged.
  if (doc.scanRegion !== undefined)
    lines.push(
      doc.scanRegion
        ? t("calibratePage.transfer.parts.scanRegion")
        : t("calibratePage.transfer.parts.scanRegionCleared"),
    );
  if (doc.captureSettleDelayMs != null)
    lines.push(
      t("calibratePage.transfer.parts.captureDelay", {
        value: doc.captureSettleDelayMs,
      }),
    );
  return lines;
}

/**
 * Moving calibration between installs.
 *
 * Calibration describes one physical machine and is the only thing in the app
 * that cannot be recomputed, so it gets a file. The CLI can do the same job,
 * but only with the app closed — PGlite allows one process per data directory —
 * which makes it useless for the case this exists for: copying values between a
 * dev build and the installed one without shutting either down.
 */
export function CalibrationTransfer() {
  const { t } = useTranslation("calibration");
  const queryClient = useQueryClient();
  const { isConnected } = useSerial();
  const { syncToDevice: syncModules } = useModuleConfigs();
  const { syncToDevice: syncFeeder } = useFeederConfig();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Partial<CalibrationDocument> | null>(
    null,
  );
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const summary = useFileSummary(pending);

  async function handleExport() {
    setIsExporting(true);
    try {
      const doc = await getCalibrationDocument();
      downloadFile(
        JSON.stringify(doc, null, 2),
        `poke-sort-calibration-${fileDateSuffix()}.json`,
        "application/json",
      );
    } catch (err) {
      toast.error(t("calibratePage.transfer.exportFailed"), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsExporting(false);
    }
  }

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Cleared unconditionally: without it, picking the same file twice fires no
    // change event, and re-importing after an edit is the normal case here.
    e.target.value = "";
    if (!file) return;

    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        toast.error(t("calibratePage.transfer.notCalibrationFile"));
        return;
      }
      setPending(parsed as Partial<CalibrationDocument>);
    } catch {
      toast.error(t("calibratePage.transfer.notJson"));
    }
  }

  async function handleApply() {
    if (!pending) return;
    setIsImporting(true);
    try {
      const result = await importCalibrationDocument(pending);
      if (!result.success) {
        toast.error(t("calibratePage.transfer.importFailed"), {
          description: result.message,
        });
        return;
      }

      // An import writes the rows behind the per-field save mutations, which
      // are what normally refresh these caches — without this the screen keeps
      // showing the values the file just replaced.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["modules"] }),
        queryClient.invalidateQueries({ queryKey: ["feeder"] }),
        queryClient.invalidateQueries({ queryKey: ["org-settings"] }),
      ]);

      setPending(null);
      toast.success(result.message);

      // The sorter holds calibration in RAM and only re-reads it on connect or
      // after a reboot, so a machine that is plugged in right now would keep
      // driving the old positions until it is unplugged.
      if (isConnected) await Promise.all([syncModules(), syncFeeder()]);
    } catch (err) {
      toast.error(t("calibratePage.transfer.importFailed"), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={handleExport} disabled={isExporting}>
        <IconFileDownload />
        {t("calibratePage.transfer.export")}
      </Button>
      <Button
        variant="outline"
        onClick={() => fileInputRef.current?.click()}
        disabled={isImporting}
      >
        <IconFileUpload />
        {t("calibratePage.transfer.import")}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleFilePicked}
      />

      <Dialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("calibratePage.transfer.confirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("calibratePage.transfer.confirmDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 flex flex-col gap-1 text-sm">
            {summary.length > 0 ? (
              summary.map((line) => (
                <div key={line} className="flex gap-2">
                  <span aria-hidden>•</span>
                  <span>{line}</span>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">
                {t("calibratePage.transfer.nothingToApply")}
              </p>
            )}
            {pending?.exportedAt && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("calibratePage.transfer.exportedAt", {
                  date: new Date(pending.exportedAt).toLocaleString(),
                })}
              </p>
            )}
            {pending?.note && (
              <p className="text-xs text-muted-foreground">{pending.note}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              {t("calibratePage.transfer.cancel")}
            </Button>
            <Button onClick={handleApply} disabled={isImporting}>
              {isImporting
                ? t("calibratePage.transfer.applying")
                : t("calibratePage.transfer.apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
