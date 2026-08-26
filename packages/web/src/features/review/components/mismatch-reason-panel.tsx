import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  REASONS_BY_KIND,
  type PendingVerdict,
} from "@/features/review/lib/review-machine";
import { cn } from "@/lib/utils";
import type { MismatchReason } from "@poke-sort/shared";
import { IconCheck } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

interface MismatchReasonPanelProps {
  pending: PendingVerdict;
  note: string;
  onNoteChange: (value: string) => void;
  onToggleReason: (reason: MismatchReason) => void;
  onSubmit: () => void;
  onCancel: () => void;
  noteInputRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * Multi-select mismatch reasons, keyed 1–9 (toggle), with an optional note.
 * Only the reasons that can apply to what is being recorded are shown — see
 * REASONS_BY_KIND.
 * Rendered as a plain overlay (not a base-ui Dialog) so the screen's own
 * keydown listener keeps handling the number keys without fighting a focus
 * trap.
 */
export function MismatchReasonPanel({
  pending,
  note,
  onNoteChange,
  onToggleReason,
  onSubmit,
  onCancel,
  noteInputRef,
}: MismatchReasonPanelProps) {
  const { t } = useTranslation("review");
  const needsReason = pending.kind !== "unresolvable";
  const canSubmit = !needsReason || pending.reasons.length > 0;
  const title =
    pending.kind === "corrected"
      ? t("reason.titleCorrected")
      : pending.kind === "variant"
        ? t("reason.titleVariant")
        : t("reason.titleUnresolvable");

  return (
    <div className="absolute inset-0 z-20 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-card border rounded-xl shadow-lg p-5 flex flex-col gap-4">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {pending.cardName && (
            <p className="text-sm text-muted-foreground mt-0.5 truncate">
              {t("reason.pickingCard", { name: pending.cardName })}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {REASONS_BY_KIND[pending.kind].map((reason, i) => {
            const selected = pending.reasons.includes(reason);
            return (
              <button
                key={reason}
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onToggleReason(reason);
                }}
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
                <span className="flex-1">{t(`reasons.${reason}`)}</span>
                {selected && <IconCheck className="size-4 shrink-0" />}
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
