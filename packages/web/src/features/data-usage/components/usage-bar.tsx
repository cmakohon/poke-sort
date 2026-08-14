import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBytes } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";
import type { DataUsageCategory, DataUsageCategoryKey } from "@poke-sort/shared";
import { useTranslation } from "react-i18next";
import { categoryRamp } from "../lib/categories";

interface UsageBarProps {
  categories: DataUsageCategory[];
  totalBytes: number;
  /** Set by hovering a legend row; dims everything else. */
  active: DataUsageCategoryKey | null;
  onActiveChange: (key: DataUsageCategoryKey | null) => void;
}

/**
 * The macOS Storage bar: one segment per category, sized by bytes.
 *
 * Sizing is `flex-grow: <bytes>` over `flex-basis: 0`, which is exactly the
 * case flexbox min-size resolution handles — a segment too small for its
 * `min-width` freezes at the floor and the remainder redistributes among the
 * rest. That is what lets a 90% catalog and a 0.3% audit table share a bar with
 * no JavaScript and no layout measurement.
 *
 * The floors do cost something: eight of them on a 700px bar borrow a few
 * percent from the largest segment. That is the deliberate trade — the bar is a
 * shape, and every exact number is in the legend directly below it.
 */
export function UsageBar({ categories, totalBytes, active, onActiveChange }: UsageBarProps) {
  const { t } = useTranslation("settings");
  // Empty categories are dropped rather than rendered at their floor, so the
  // minimum widths are spent only on things that actually exist.
  const segments = categories.filter((c) => c.bytes > 0);

  if (segments.length === 0) {
    return <div className="h-3 w-full rounded-full bg-muted" />;
  }

  return (
    <div
      className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={t("dataUsage.barLabel", { total: formatBytes(totalBytes) })}
    >
      {segments.map((segment) => {
        const percent = totalBytes > 0 ? (segment.bytes / totalBytes) * 100 : 0;
        return (
          <Tooltip key={segment.key}>
            <TooltipTrigger
              render={<div />}
              style={{ flexGrow: segment.bytes, flexBasis: 0 }}
              className={cn(
                "min-w-[4px] shrink transition-[flex-grow,opacity] duration-300",
                categoryRamp(segment.key),
                active && active !== segment.key && "opacity-30",
              )}
              onMouseEnter={() => onActiveChange(segment.key)}
              onMouseLeave={() => onActiveChange(null)}
            />
            <TooltipContent>
              {t(`dataUsage.categories.${segment.key}.label`)} ·{" "}
              {formatBytes(segment.bytes)} · {percent.toFixed(percent < 1 ? 1 : 0)}%
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
