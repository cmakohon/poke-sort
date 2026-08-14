import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PendingVerdict } from "@/features/review/lib/review-machine";
import { cn } from "@/lib/utils";
import { MISMATCH_REASONS, type MismatchReason } from "@poke-sort/shared";
import { useTranslation } from "react-i18next";

interface MismatchReasonPanelProps {
  pending: PendingVerdict;
  note: string;
  onNoteChange: (value: string) => void;
  onSelectReason: (reason: MismatchReason) => void;
  onSubmit: () => void;
  onCancel: () => void;
  noteInputRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * Single-select mismatch reason, keyed 1–8, with an optional note. Rendered
 * as a plain overlay (not a base-ui Dialog) so the screen's own keydown
 * listener keeps handling the number keys without fighting a focus trap.
 */
export function MismatchReasonPanel({
  pending,
  note,
  onNoteChange,
  onSelectReason,
  onSubmit,
  onCancel,
  noteInputRef,
}: MismatchReasonPanelProps) {
  const { t } = useTranslation("review");
  const needsReason = pending.kind === "corrected";
  const canSubmit = !needsReason || pending.reason != null;

  return (
    <div className="absolute inset-0 z-20 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-card border rounded-xl shadow-lg p-5 flex flex-col gap-4">
        <div>
          <h3 className="font-semibold">
            {needsReason
              ? t("reason.titleCorrected")
              : t("reason.titleUnresolvable")}
          </h3>
          {pending.cardName && (
            <p className="text-sm text-muted-foreground mt-0.5 truncate">
              {t("reason.pickingCard", { name: pending.cardName })}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {MISMATCH_REASONS.map((reason, i) => {
            const selected = pending.reason === reason;
            return (
              <button
                key={reason}
                type="button"
                onClick={() => onSelectReason(reason)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-left transition-colors",
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-secondary",
                )}
              >
                <kbd
                  className={cn(
                    "size-5 grid place-items-center rounded border text-[11px] font-semibold shrink-0",
                    selected
                      ? "border-primary-foreground/40"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {i + 1}
                </kbd>
                {t(`reasons.${reason}`)}
              </button>
            );
          })}
        </div>
        <Input
          ref={noteInputRef}
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder={t("reason.notePlaceholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t("reason.cancel")}
          </Button>
          <Button size="sm" onClick={onSubmit} disabled={!canSubmit}>
            {needsReason ? t("reason.submit") : t("reason.submitSkip")}
          </Button>
        </div>
      </div>
    </div>
  );
}
