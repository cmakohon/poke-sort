import { Button } from "@/components/ui/button";
import { formatBytes, formatCount } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";
import type { DataUsageCategory, DataUsageCategoryKey } from "@poke-sort/shared";
import { IconChevronRight } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { CATEGORIES_WITH_HINTS, CATEGORY_LINKS, categoryRamp } from "../lib/categories";

interface UsageLegendProps {
  categories: DataUsageCategory[];
  active: DataUsageCategoryKey | null;
  onActiveChange: (key: DataUsageCategoryKey | null) => void;
  onTrim: (category: DataUsageCategory) => void;
  disabled: boolean;
}

/**
 * The accessible, exact version of the bar.
 *
 * The bar carries one summary label and no per-segment semantics on purpose:
 * screen readers get this list instead, where every size, count and action is
 * plain text rather than a proportion.
 */
export function UsageLegend({
  categories,
  active,
  onActiveChange,
  onTrim,
  disabled,
}: UsageLegendProps) {
  const { t } = useTranslation("settings");

  return (
    <ul className="flex flex-col">
      {categories.map((category) => {
        const link = CATEGORY_LINKS[category.key];
        const showHint = CATEGORIES_WITH_HINTS.includes(category.key);
        const reviewed = category.protectedCount ?? 0;
        return (
          <li
            key={category.key}
            className={cn(
              "flex items-start gap-3 rounded-md px-2 py-2 transition-colors",
              active === category.key && "bg-muted/60",
            )}
            onMouseEnter={() => onActiveChange(category.key)}
            onMouseLeave={() => onActiveChange(null)}
          >
            <span
              aria-hidden
              className={cn("mt-1.5 size-2.5 shrink-0 rounded-[3px]", categoryRamp(category.key))}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm">{t(`dataUsage.categories.${category.key}.label`)}</span>
              {category.count !== null && category.countUnit && (
                <span className="text-xs text-muted-foreground">
                  {t(`dataUsage.count.${category.countUnit}`, {
                    count: category.count,
                    formatted: formatCount(category.count),
                  })}
                  {reviewed > 0 && <> · {t("dataUsage.protectedKept", { count: reviewed })}</>}
                </span>
              )}
              {showHint && (
                <span className="text-xs text-muted-foreground">
                  {t(`dataUsage.categories.${category.key}.hint`)}
                </span>
              )}
              {/* Only when there is something to say. Zero reusable bytes and
                  an unavailable stats view look identical to a user, and only
                  one of them is a fact we have. */}
              {category.reusableBytes !== null && category.reusableBytes > 0 && (
                <span className="text-xs text-muted-foreground">
                  {t("dataUsage.reusable", { size: formatBytes(category.reusableBytes) })}
                </span>
              )}
            </div>
            <span className="w-20 shrink-0 pt-0.5 text-right text-sm tabular-nums">
              {formatBytes(category.bytes)}
            </span>
            <div className="w-24 shrink-0 text-right">
              {category.trimmable ? (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={disabled || category.bytes === 0}
                  onClick={() => onTrim(category)}
                >
                  {t("dataUsage.trim.button")}
                </Button>
              ) : link ? (
                // The catalog is ~90% of the bar and the first thing anyone
                // asks how to shrink, so its row answers the question instead
                // of leaving the user to find the admin page.
                <Button variant="ghost" size="xs" render={<Link to={link} />}>
                  {t(`dataUsage.categories.${category.key}.manageLink`)}
                  <IconChevronRight className="size-3.5" />
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
