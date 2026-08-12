import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LANGUAGE_LABELS } from "@/lib/languages";
import {
  getCatalogImportState,
  getCatalogStatus,
  startCatalogImport,
} from "@/lib/api/admin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * First-run catalog setup.
 *
 * A fresh install has no recognition data, so nothing can be identified — and
 * learning 23,444 cards locally is hours of CPU. The expected path is to
 * import a prebuilt pack, which is a download plus a few seconds of inserts.
 * Running a full sync instead remains possible from the panel above; it is
 * just slow.
 */
export function CatalogSetup({
  gameKey,
  lang = "en",
  gameLabel,
}: {
  gameKey: string;
  lang?: string;
  /** Display name for the game; falls back to the raw key. */
  gameLabel?: string;
}) {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");

  const statusQuery = useQuery({
    queryKey: ["catalog-status", gameKey, lang],
    queryFn: () => getCatalogStatus(gameKey, lang),
  });

  const jobQuery = useQuery({
    queryKey: ["catalog-import"],
    queryFn: getCatalogImportState,
    // Poll only while something is in flight.
    refetchInterval: (query) => {
      const phase = query.state.data?.phase;
      return phase === "downloading" || phase === "importing" ? 1000 : false;
    },
  });

  const importMutation = useMutation({
    mutationFn: () => startCatalogImport(gameKey, lang, url || undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["catalog-import"] });
    },
  });

  const job = jobQuery.data;
  const busy = job?.phase === "downloading" || job?.phase === "importing";
  const count = statusQuery.data?.count ?? 0;

  const game = gameLabel ?? gameKey;
  const language = LANGUAGE_LABELS[lang] ?? lang;

  // Refresh the count once an import finishes.
  if (job?.phase === "completed" && count === 0 && !statusQuery.isFetching) {
    void queryClient.invalidateQueries({ queryKey: ["catalog-status"] });
  }

  const progress = (() => {
    if (job?.phase === "downloading" && job.totalBytes) {
      return {
        label: t("catalogSetup.downloadingOf", {
          done: (job.downloadedBytes / 1e6).toFixed(0),
          total: (job.totalBytes / 1e6).toFixed(0),
        }),
        value: job.downloadedBytes / job.totalBytes,
      };
    }
    if (job?.phase === "downloading") {
      return {
        label: t("catalogSetup.downloading", {
          done: (job.downloadedBytes / 1e6).toFixed(0),
        }),
        value: null,
      };
    }
    if (job?.phase === "importing" && job.cards) {
      return {
        label: t("catalogSetup.importingCards", {
          done: job.imported,
          total: job.cards,
        }),
        value: job.imported / job.cards,
      };
    }
    return null;
  })();

  return (
    <div className="rounded-lg border p-4 flex flex-col gap-3 mt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">
            {t("catalogSetup.heading")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {count > 0
              ? t("catalogSetup.statusReady", {
                  count,
                  formattedCount: count.toLocaleString(),
                  game,
                  language,
                })
              : t("catalogSetup.statusEmpty", { game })}
          </p>
        </div>
        <Button
          size="sm"
          disabled={busy || importMutation.isPending}
          onClick={() => importMutation.mutate()}
        >
          {busy
            ? t("catalogSetup.importing")
            : count > 0
              ? t("catalogSetup.reimport")
              : t("catalogSetup.import")}
        </Button>
      </div>

      {progress && (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-[width] duration-300"
              style={{ width: `${((progress.value ?? 0.05) * 100).toFixed(1)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{progress.label}</p>
        </div>
      )}

      {job?.phase === "completed" && job.message && (
        <p className="text-xs text-muted-foreground">{job.message}</p>
      )}
      {job?.phase === "failed" && job.message && (
        <p className="text-xs text-destructive">{job.message}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium">{t("catalogSetup.packSource")}</p>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={statusQuery.data?.packUrl ?? ""}
          disabled={busy}
        />
        <p className="text-xs text-muted-foreground">
          {t("catalogSetup.packSourceHint")}
        </p>
      </div>
    </div>
  );
}
