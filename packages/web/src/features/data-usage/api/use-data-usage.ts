import { formatBytes } from "@/lib/format-bytes";
import { TOAST_DURATION_MS } from "@/lib/toast";
import type { TrimOutcome, TrimRequest } from "@poke-sort/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  DATA_USAGE_QUERY_KEY,
  dataUsageQueryOptions,
  getDataUsage,
  trimData,
} from "./data-usage";

export function useDataUsage() {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const query = useQuery(dataUsageQueryOptions());

  const refreshMutation = useMutation({
    mutationFn: () => getDataUsage(true),
    onSuccess: (result) => {
      if (result.data) queryClient.setQueryData(DATA_USAGE_QUERY_KEY, result.data);
    },
  });

  const trimMutation = useMutation({
    mutationFn: async (request: TrimRequest): Promise<TrimOutcome> => {
      const result = await trimData(request);
      // Thrown rather than returned, so DeleteDialog keeps itself open on a
      // failure instead of closing as if the delete had happened.
      if (!result.success || !result.data) {
        throw new Error(result.message ?? "Trim failed");
      }
      return result.data;
    },
    onSuccess: (outcome) => {
      // The server dropped its own cache before responding, so this refetch is
      // a real measurement rather than the numbers from before the delete.
      void queryClient.invalidateQueries({ queryKey: DATA_USAGE_QUERY_KEY });
      // A diagnostics trim removes rows the review queue is built from.
      void queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      void queryClient.invalidateQueries({ queryKey: ["review-stats"] });

      // Three separate sentences rather than one assembled from fragments:
      // "records" and "images" pluralise independently, and joining them by
      // hand is how a translation ends up ungrammatical.
      const { rowsDeleted: rows, filesDeleted: files } = outcome;
      const headline =
        rows > 0 && files > 0
          ? t("dataUsage.toasts.trimBoth", { rows, files })
          : rows > 0
            ? t("dataUsage.toasts.trimRows", { count: rows })
            : files > 0
              ? t("dataUsage.toasts.trimFiles", { count: files })
              : t("dataUsage.toasts.trimNothing");

      toast.success(headline, {
        // Two different facts, never conflated: an unlink returns disk to the
        // OS, a row delete only frees space inside the database file.
        description:
          outcome.bytesFreedOnDisk > 0
            ? t("dataUsage.toasts.freed", { size: formatBytes(outcome.bytesFreedOnDisk) })
            : rows > 0
              ? t("dataUsage.trim.notShrinkNote")
              : undefined,
        duration: TOAST_DURATION_MS,
      });
    },
    onError: () => toast.error(t("dataUsage.toasts.trimError")),
  });

  return {
    snapshot: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refresh: () => refreshMutation.mutate(),
    isRefreshing: refreshMutation.isPending || query.isFetching,
    trim: trimMutation.mutateAsync,
    isTrimming: trimMutation.isPending,
  };
}
