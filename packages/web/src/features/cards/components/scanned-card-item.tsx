import { rarityColor } from "@/features/cards/lib/rarity-color";
import { formatCardNumber } from "@/features/cards/lib/format-card-number";
import { formatUsd } from "@/features/scanner/components/scan-stats";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BinLocationDiagram } from "@/features/bins/components/bin-location-diagram";
import type { ScannedCardItemProps } from "@/features/cards/types";
import { cn } from "@/lib/utils";
import {
  IconCheck,
  IconDownload,
  IconEyeCheck,
  IconHelpCircle,
  IconSparkles,
} from "@tabler/icons-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

export const ScannedCardItem = memo(function ScannedCardItem({
  card,
  onOpen,
  binNumber,
  isSelected = false,
  onToggleSelect,
  hasAlternatives = false,
  isFoil = false,
  isDownloaded = false,
  wasCorrected = false,
  needsReview,
  reviewVerdict,
}: ScannedCardItemProps) {
  const { t } = useTranslation("cards");
  // The amber ? means "the pipeline was unsure" — held for review, or (for
  // rows predating the tier system) had close alternative matches. A human
  // verdict settles the question, so it clears the marker.
  const showAttention =
    reviewVerdict == null && (needsReview ?? hasAlternatives);
  return (
    <div
      className={cn(
        "relative rounded-lg p-1 bg-muted border transition-shadow",
        isSelected && "ring-2 ring-primary ring-offset-1",
      )}
    >
      <button type="button" className="w-full cursor-pointer" onClick={onOpen}>
        <div className="aspect-[2.5/3.5] rounded-lg overflow-hidden relative">
          {showAttention && (
            <div
              className="absolute top-1 left-1 z-20 rounded-full bg-amber-500 p-0.5 shadow-md"
              title={t("scannedCardItem.multipleMatchesTooltip")}
            >
              <IconHelpCircle className="size-3 text-white" />
            </div>
          )}
          {isFoil && (
            <div
              className={cn(
                "absolute top-1 z-20 rounded-full p-0.5 shadow-md bg-gradient-to-br from-fuchsia-400 via-cyan-400 to-amber-300",
                showAttention ? "left-6" : "left-1",
              )}
              title={t("scannedCardItem.foil")}
            >
              <IconSparkles className="size-3 text-white" />
            </div>
          )}
          <div className="absolute bottom-1 left-1 right-1 flex gap-1 items-center justify-between z-20">
            {/* A human verdict outranks everything: the original scan
                confidence is preserved in originalDistance/originalScore,
                but what the tile shows is that a person has judged this
                card. wasCorrected alone (scanner-screen path before review
                state existed) still shows Confirmed. */}
            {reviewVerdict != null ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Badge
                      variant={
                        reviewVerdict === "unresolvable"
                          ? "secondary"
                          : "default"
                      }
                    >
                      <IconEyeCheck className="size-3" />
                      {t(`scannedCardItem.reviewed.${reviewVerdict}`)}
                    </Badge>
                  }
                />
                <TooltipContent>
                  {t("scannedCardItem.reviewedTooltip")}
                </TooltipContent>
              </Tooltip>
            ) : wasCorrected ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Badge variant="default">
                      <IconCheck className="size-3" />
                      {t("scannedCardItem.confirmed")}
                    </Badge>
                  }
                />
                <TooltipContent>
                  {t("scannedCardItem.confirmedTooltip")}
                </TooltipContent>
              </Tooltip>
            ) : card.distance != null ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Badge
                      variant={
                        card.distance < 0.15 ? "default" : "destructive"
                      }
                    >
                      {Math.round(100 - card.distance * 100)}%
                    </Badge>
                  }
                />
                <TooltipContent>
                  {t("scannedCardItem.matchTooltip")}
                </TooltipContent>
              </Tooltip>
            ) : (
              <span />
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Badge variant="secondary" className="shadow-md">
                    {t("scannedCardItem.bin", { number: binNumber })}
                  </Badge>
                }
              />
              <TooltipContent side="top" className="p-0">
                <BinLocationDiagram binNumber={binNumber} />
              </TooltipContent>
            </Tooltip>
          </div>
          <img
            src={card.image?.normal || ""}
            alt={card.name}
            className="w-full h-full object-cover"
          />
        </div>
      </button>
      {onToggleSelect && (
        <Button
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          variant={isSelected ? "default" : "secondary"}
          className="absolute top-2 right-2 z-30"
        >
          <IconCheck />
        </Button>
      )}
      <div className="flex flex-row justify-between items-center px-1 pb-1 gap-2">
        <div className="flex flex-row items-center gap-2 min-w-0">
          <div
            className="size-3 rounded-full shrink-0"
            style={{ backgroundColor: rarityColor(card.rarity) }}
          />
          <p
            className="text-xs font-semibold truncate min-w-0"
            title={`${card.setName || card.set} (${card.set.toUpperCase()})`}
          >
            {card.setName || card.set.toUpperCase()}
          </p>
          <p className="text-xs text-muted-foreground shrink-0">
            {formatCardNumber(card)}
          </p>
          {isDownloaded && (
            <span title={t("scannedCardItem.downloaded")}>
              <IconDownload className="size-3 text-muted-foreground shrink-0" />
            </span>
          )}
        </div>
        {card.price != null && (
          <p className="text-xs font-medium text-muted-foreground shrink-0">
            {formatUsd(card.price)}
          </p>
        )}
      </div>
    </div>
  );
});
