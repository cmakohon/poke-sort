import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCardNumber } from "@/features/cards/lib/format-card-number";
import { captureImageUrl } from "@/features/review/api/use-review-queue";
import { cn } from "@/lib/utils";
import type { ReviewCandidate, ReviewDetail, ReviewQueueItem } from "@poke-sort/shared";
import { IconCheck, IconPencil, IconPhotoOff, IconQuestionMark } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

interface ReviewFocusProps {
  item: ReviewQueueItem;
  detail: ReviewDetail | null | undefined;
  detailLoading: boolean;
  predicted: ReviewCandidate | null;
  rotated: boolean;
}

const TIER_STYLES: Record<string, string> = {
  accept: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  review: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  "no-match": "bg-red-500/15 text-red-700 dark:text-red-400",
};

/** Capture on the left, the sorter's pick on the right, scan metadata below. */
export function ReviewFocus({
  item,
  detail,
  detailLoading,
  predicted,
  rotated,
}: ReviewFocusProps) {
  const { t } = useTranslation("review");
  const captureUrl = captureImageUrl(item.capturePath);
  const ocr = detail?.ocr;

  return (
    <div className="flex gap-6 items-start">
      {/* Scanned capture */}
      <div className="shrink-0 flex flex-col gap-1.5 items-center">
        <p className="text-xs font-medium text-muted-foreground">
          {t("focus.capture")}
        </p>
        <div className="w-56 aspect-[2.5/3.5] rounded-lg overflow-hidden border shadow-sm bg-muted">
          {captureUrl ? (
            <img
              src={captureUrl}
              alt={t("focus.capture")}
              className={cn(
                "w-full h-full object-cover transition-transform",
                rotated && "rotate-180",
              )}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <IconPhotoOff className="size-6" />
              <span className="text-xs text-center px-3">
                {t("focus.capturePruned")}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Sorter's pick */}
      <div className="shrink-0 flex flex-col gap-1.5 items-center">
        <p className="text-xs font-medium text-muted-foreground">
          {t("focus.predicted")}
        </p>
        <div className="w-56 aspect-[2.5/3.5] rounded-lg overflow-hidden border shadow-sm bg-muted">
          {detailLoading ? (
            <Skeleton className="w-full h-full" />
          ) : predicted?.card?.image?.normal || predicted?.card?.image?.small ? (
            <img
              src={predicted.card.image?.normal || predicted.card.image?.small || ""}
              alt={predicted.card.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <IconQuestionMark className="size-6" />
              <span className="text-xs text-center px-3">
                {predicted
                  ? (predicted.name ?? predicted.id)
                  : t("focus.noPrediction")}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Scan metadata */}
      <div className="flex flex-col gap-2 min-w-0 flex-1 pt-6">
        {predicted?.card && (
          <div>
            <p className="font-semibold truncate">{predicted.card.name}</p>
            <p className="text-sm text-muted-foreground truncate">
              {[
                predicted.card.setName || predicted.card.set.toUpperCase(),
                formatCardNumber(predicted.card),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant="secondary"
            className={cn("capitalize", TIER_STYLES[item.tier])}
          >
            {item.tier}
          </Badge>
          {item.reviewVerdict && (
            <Badge variant="outline" className="gap-1">
              {item.reviewVerdict === "correct" && (
                <IconCheck className="size-3" />
              )}
              {item.reviewVerdict === "corrected" && (
                <IconPencil className="size-3" />
              )}
              {t(`focus.reviewedBadge.${item.reviewVerdict}`)}
            </Badge>
          )}
          {detail?.hasLinkedCard && (
            <Badge variant="outline">{t("focus.linkedCard")}</Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground flex flex-col gap-0.5 tabular-nums">
          {item.score != null && (
            <span>
              {t("focus.score")}: {(item.score * 100).toFixed(1)}%
            </span>
          )}
          {item.margin != null && (
            <span>
              {t("focus.margin")}: {(item.margin * 100).toFixed(1)}%
            </span>
          )}
          {(ocr?.name || ocr?.collectorNumberRaw || ocr?.collectorNumber) && (
            <span className="truncate">
              {t("focus.ocr")}:{" "}
              {[ocr?.name, ocr?.collectorNumberRaw ?? ocr?.collectorNumber]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
          <span>{new Date(item.createdAt).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
