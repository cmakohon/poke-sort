import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";
import type {
  DataUsageCategory,
  DataUsageCategoryKey,
  TrimAge,
  TrimmableCategoryKey,
} from "@poke-sort/shared";
import { IconRefresh } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDataUsage } from "../api/use-data-usage";
import { CATEGORY_ORDER } from "../lib/categories";
import { RetentionSettings } from "./retention-settings";
import { TrimDialog } from "./trim-dialog";
import { UsageBar } from "./usage-bar";
import { UsageLegend } from "./usage-legend";

export function DataUsagePanel() {
  const { t } = useTranslation("settings");
  const { snapshot, isLoading, isError, refresh, isRefreshing, trim, isTrimming } =
    useDataUsage();
  const [active, setActive] = useState<DataUsageCategoryKey | null>(null);
  const [trimming, setTrimming] = useState<DataUsageCategory | null>(null);

  const categories = useMemo(() => {
    if (!snapshot) return [];
    const byKey = new Map(snapshot.categories.map((c) => [c.key, c]));
    return CATEGORY_ORDER.map((key) => byKey.get(key)).filter(
      (c): c is DataUsageCategory => !!c,
    );
  }, [snapshot]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-full rounded-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError || !snapshot) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("dataUsage.loadError")}</p>
        <Button variant="outline" size="sm" onClick={refresh}>
          {t("dataUsage.refresh")}
        </Button>
      </div>
    );
  }

  const handleTrim = async (category: TrimmableCategoryKey, olderThan: TrimAge) => {
    await trim({ category, olderThan });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums">
          {formatBytes(snapshot.totalBytes)}
        </span>
        {snapshot.diskFreeBytes !== null && snapshot.diskTotalBytes !== null && (
          <span className="text-xs text-muted-foreground">
            {t("dataUsage.diskFree", {
              free: formatBytes(snapshot.diskFreeBytes),
              total: formatBytes(snapshot.diskTotalBytes),
            })}
          </span>
        )}
      </div>

      <UsageBar
        categories={categories}
        totalBytes={snapshot.totalBytes}
        active={active}
        onActiveChange={setActive}
      />

      <UsageLegend
        categories={categories}
        active={active}
        onActiveChange={setActive}
        onTrim={setTrimming}
        disabled={isTrimming}
      />

      {/* A partial measurement says so rather than quietly under-reporting: a
          missing segment looks exactly like a small one. */}
      {snapshot.warnings.length > 0 && (
        <p className="text-xs text-destructive">
          {t("dataUsage.partial", { parts: snapshot.warnings.join(", ") })}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {t("dataUsage.measuredAt", {
            time: new Date(snapshot.computedAt).toLocaleTimeString(),
          })}
          {snapshot.modelBytes !== null && (
            <> · {t("dataUsage.model", { size: formatBytes(snapshot.modelBytes) })}</>
          )}
        </span>
        <Button
          variant="ghost"
          size="xs"
          onClick={refresh}
          disabled={isRefreshing}
          aria-label={t("dataUsage.refresh")}
        >
          <IconRefresh className={cn(isRefreshing && "animate-spin")} />
          {t("dataUsage.refresh")}
        </Button>
      </div>

      <Separator />
      <RetentionSettings />

      <TrimDialog
        category={trimming}
        onClose={() => setTrimming(null)}
        onConfirm={handleTrim}
      />
    </div>
  );
}
