import { formatCardNumber } from "@/features/cards/lib/format-card-number";
import { cn } from "@/lib/utils";
import type { ReviewCandidate } from "@poke-sort/shared";
import { useTranslation } from "react-i18next";

interface CandidateRowProps {
  alternates: ReviewCandidate[];
  onPick: (candidate: ReviewCandidate) => void;
}

/**
 * The 1–5 alternates. A candidate whose catalog id no longer hydrates
 * renders as a name-only tile — art must never block a verdict.
 */
export function CandidateRow({ alternates, onPick }: CandidateRowProps) {
  const { t } = useTranslation("review");

  if (alternates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        {t("focus.noAlternates")}
      </p>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {alternates.map((candidate, i) => (
        <button
          key={candidate.id}
          type="button"
          // blur before dispatching: this row stays mounted under the reason
          // overlay, and a still-focused button swallows the Enter that submits.
          onClick={(e) => {
            e.currentTarget.blur();
            onPick(candidate);
          }}
          className="shrink-0 flex flex-col gap-1.5 items-start cursor-pointer group w-28"
        >
          <div className="relative w-28 aspect-[2.5/3.5] rounded-lg overflow-hidden border-2 border-border group-hover:border-primary/60 transition-all bg-muted">
            {candidate.card?.image?.small || candidate.card?.image?.normal ? (
              <img
                src={
                  candidate.card.image?.small ||
                  candidate.card.image?.normal ||
                  ""
                }
                alt={candidate.card.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center p-2">
                <span className="text-xs text-muted-foreground text-center leading-snug">
                  {candidate.name ?? candidate.id}
                </span>
              </div>
            )}
            <kbd className="absolute top-1 left-1 size-5 grid place-items-center rounded bg-black/70 text-white text-[11px] font-semibold">
              {i + 1}
            </kbd>
          </div>
          <div className="w-full min-w-0">
            <p className="text-xs font-medium truncate">
              {candidate.card?.name ?? candidate.name ?? candidate.id}
            </p>
            <p className="text-[10px] text-muted-foreground truncate">
              {candidate.card
                ? [
                    candidate.card.setName || candidate.card.set.toUpperCase(),
                    formatCardNumber(candidate.card),
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : candidate.id}
            </p>
            <p
              className={cn(
                "text-[10px] tabular-nums",
                candidate.score >= 0.5
                  ? "text-muted-foreground"
                  : "text-amber-600 dark:text-amber-500",
              )}
            >
              {(candidate.score * 100).toFixed(1)}%
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
