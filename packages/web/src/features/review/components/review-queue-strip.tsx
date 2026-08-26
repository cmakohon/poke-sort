import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ReviewStats } from "@poke-sort/shared";
import {
  IconChevronLeft,
  IconChevronRight,
  IconKeyboard,
  IconRefresh,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

interface ReviewQueueStripProps {
  stats: ReviewStats | null | undefined;
  position: number;
  totalLoaded: number;
  hasMore: boolean;
  showReviewed: boolean;
  onToggleReviewed: () => void;
  includeAccepted: boolean;
  onToggleAccepted: () => void;
  /** Scans that have landed since the queue was last pulled. */
  newSinceRefresh: number;
  onRefresh: () => void;
  onToggleHelp: () => void;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
}

/** Compact header: queue counts, position, filters, shortcut help. */
export function ReviewQueueStrip({
  stats,
  position,
  totalLoaded,
  hasMore,
  showReviewed,
  onToggleReviewed,
  includeAccepted,
  onToggleAccepted,
  newSinceRefresh,
  onRefresh,
  onToggleHelp,
  onPrev,
  onNext,
  canPrev,
  canNext,
}: ReviewQueueStripProps) {
  const { t } = useTranslation("review");
  // Count what this queue would actually hand back, accepts included only when
  // the operator asked for them — a badge advertising work the filter hides is
  // a badge that never reaches zero.
  const unreviewedTotal = stats
    ? stats.unreviewed.review +
      stats.unreviewed["no-match"] +
      (includeAccepted ? stats.unreviewed.accept : 0)
    : null;

  return (
    <div className="flex items-center gap-3 border-b px-4 py-2 shrink-0 flex-wrap">
      <h1 className="font-semibold text-sm">{t("title")}</h1>
      {unreviewedTotal != null && (
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary">
            {t("queue.unreviewed", { count: unreviewedTotal })}
          </Badge>
          {stats && stats.unreviewed.review > 0 && (
            <Badge
              variant="secondary"
              className="bg-amber-500/15 text-amber-700 dark:text-amber-400"
            >
              {stats.unreviewed.review} {t("queue.tierReview")}
            </Badge>
          )}
          {stats && stats.unreviewed["no-match"] > 0 && (
            <Badge
              variant="secondary"
              className="bg-red-500/15 text-red-700 dark:text-red-400"
            >
              {stats.unreviewed["no-match"]} {t("queue.tierNoMatch")}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {t("queue.reviewedTotal", { count: stats?.reviewed ?? 0 })}
          </span>
        </div>
      )}
      <div className="flex-1" />
      {totalLoaded > 0 && (
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={!canPrev}
            onClick={(e) => {
              e.currentTarget.blur();
              onPrev();
            }}
            aria-label={t("actions.prev")}
          >
            <IconChevronLeft className="size-4" />
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("queue.progress", {
              current: Math.min(position + 1, totalLoaded),
              total: `${totalLoaded}${hasMore ? "+" : ""}`,
            })}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={!canNext}
            onClick={(e) => {
              e.currentTarget.blur();
              onNext();
            }}
            aria-label={t("actions.next")}
          >
            <IconChevronRight className="size-4" />
          </Button>
        </div>
      )}
      <Label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
        <Switch checked={showReviewed} onCheckedChange={onToggleReviewed} />
        {t("queue.showReviewed")}
        <kbd className="px-1 rounded border text-[10px]">R</kbd>
      </Label>
      <Label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
        <Switch checked={includeAccepted} onCheckedChange={onToggleAccepted} />
        {t("queue.includeAccepted")}
        <kbd className="px-1 rounded border text-[10px]">A</kbd>
      </Label>
      {/* The queue is not polled, so this is how a sort running behind the
          operator announces itself — a count they can act on, not a list that
          reshuffles under them. */}
      <Button
        size={newSinceRefresh > 0 ? "sm" : "icon"}
        variant={newSinceRefresh > 0 ? "secondary" : "ghost"}
        className={newSinceRefresh > 0 ? "h-7 gap-1.5" : "size-7"}
        onClick={onRefresh}
        aria-label={t("queue.refresh")}
      >
        <IconRefresh className="size-4" />
        {newSinceRefresh > 0 && (
          <span className="text-xs tabular-nums">
            {t("queue.newSinceRefresh", { count: newSinceRefresh })}
          </span>
        )}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        onClick={onToggleHelp}
        aria-label={t("shortcuts.title")}
      >
        <IconKeyboard className="size-4" />
      </Button>
    </div>
  );
}
