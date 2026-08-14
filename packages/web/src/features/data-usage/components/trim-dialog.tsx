import { DeleteDialog } from "@/components/delete-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCount } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";
import {
  TRIM_AGES,
  type DataUsageCategory,
  type TrimAge,
  type TrimmableCategoryKey,
} from "@poke-sort/shared";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface TrimDialogProps {
  category: DataUsageCategory | null;
  onClose: () => void;
  onConfirm: (category: TrimmableCategoryKey, olderThan: TrimAge) => Promise<unknown>;
}

/**
 * Two dialogs, on purpose.
 *
 * The first picks an age and shows exactly how many rows or files that age
 * reaches, so the choice is made against a real number rather than a guess.
 * The second is the existing DeleteDialog and does nothing but confirm — a
 * bounded trim clears with one click, and anything unbounded requires typing
 * the keyword. Collapsing the two would mean either a confirmation with no
 * preview or a preview that deletes on the first click.
 */
export function TrimDialog({ category, onClose, onConfirm }: TrimDialogProps) {
  const { t } = useTranslation("settings");
  const [age, setAge] = useState<TrimAge | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Reopening for a different category must not inherit the previous choice.
  useEffect(() => {
    if (category) {
      setAge(null);
      setConfirming(false);
    }
  }, [category]);

  if (!category?.trimPreview) return null;
  const key = category.key as TrimmableCategoryKey;
  const preview = category.trimPreview;
  const unit = category.countUnit ?? "files";
  const reviewed = category.protectedCount ?? 0;
  // Captures are files on disk; everything else deletes database rows, and
  // only one of those two actually gives the disk back.
  const isFileBacked = key === "scanCaptures";

  const confirmDescription =
    age === "all"
      ? t(`dataUsage.trim.confirmAll.${key}`, { count: preview.all })
      : t(`dataUsage.trim.confirmBounded.${key}`, {
          count: age ? preview[age] : 0,
          age: t(`dataUsage.trim.age.${age ?? "1w"}`),
        });

  return (
    <>
      <Dialog open={!!category && !confirming} onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("dataUsage.trim.dialogTitle", {
                category: t(`dataUsage.categories.${key}.label`),
              })}
            </DialogTitle>
            <DialogDescription>
              {t(`dataUsage.trim.dialogDescription.${key}`)}
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 flex flex-col gap-1.5">
            {TRIM_AGES.map((option) => {
              const affected = preview[option];
              return (
                <button
                  key={option}
                  type="button"
                  disabled={affected === 0}
                  onClick={() => setAge(option)}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                    "disabled:cursor-not-allowed disabled:opacity-40",
                    age === option
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50 not-disabled:hover:border-border",
                  )}
                >
                  <span className="text-sm">{t(`dataUsage.trim.age.${option}`)}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {t(`dataUsage.trim.affected.${unit}`, {
                      count: affected,
                      formatted: formatCount(affected),
                    })}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 text-xs text-muted-foreground">
            {reviewed > 0 && (
              <p className="flex gap-2">
                <IconAlertTriangle className="mt-px size-3.5 shrink-0" />
                <span>{t("dataUsage.trim.protectedNote", { count: reviewed })}</span>
              </p>
            )}
            {/* Said before the delete, not only after it, because "reclaim
                space" is what the user came here to do and this is the case
                where they will not get it. */}
            {!isFileBacked && <p>{t("dataUsage.trim.notShrinkNote")}</p>}
          </div>

          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("dataUsage.trim.cancel")}
            </Button>
            <Button type="button" disabled={!age} onClick={() => setConfirming(true)}>
              {t("dataUsage.trim.continue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open) setConfirming(false);
        }}
        title={t("dataUsage.trim.confirmTitle", {
          category: t(`dataUsage.categories.${key}.label`),
        })}
        description={confirmDescription}
        // An age-bounded trim is previewed and recoverable in the sense that
        // matters — telemetry and captures regenerate. "Everything" is not, so
        // it takes the keyword.
        confirm={age === "all" ? { type: "keyword" } : { type: "simple" }}
        confirmLabel={t("dataUsage.trim.confirmLabel")}
        onConfirm={async () => {
          if (!age) return;
          await onConfirm(key, age);
          setConfirming(false);
          onClose();
        }}
      />
    </>
  );
}
