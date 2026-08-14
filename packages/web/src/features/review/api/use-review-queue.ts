import { useScannedCards } from "@/features/scanner/api/use-scanned-cards";
import { API_BASE } from "@/lib/api/client";
import type {
  ReviewQueueItem,
  ReviewQueuePage,
  ReviewVerdictRequest,
} from "@poke-sort/shared";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  getReviewDetail,
  getReviewQueue,
  getReviewStats,
  submitVerdict,
  type ReviewQueueStatus,
} from "./review";

export function captureImageUrl(capturePath: string | null): string | null {
  return capturePath ? `${API_BASE}/api/captures/${capturePath}` : null;
}

const detailQueryOptions = (guid: string) => ({
  queryKey: ["review-detail", guid],
  queryFn: () => getReviewDetail(guid).then((r) => r.data ?? null),
  staleTime: 5 * 60_000,
});

export function useReviewQueue(status: ReviewQueueStatus) {
  const query = useInfiniteQuery({
    queryKey: ["review-queue", status],
    queryFn: ({ pageParam }) =>
      getReviewQueue(status, pageParam).then((r) => {
        if (!r.data) throw new Error("Empty queue response");
        return r.data;
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  return { ...query, items };
}

export function useReviewStats() {
  return useQuery({
    queryKey: ["review-stats"],
    queryFn: () => getReviewStats().then((r) => r.data ?? null),
    refetchInterval: 30_000,
  });
}

export function useReviewDetail(guid: string | undefined) {
  return useQuery({
    ...detailQueryOptions(guid ?? ""),
    enabled: !!guid,
  });
}

/** Warms the next items' detail queries so advancing feels instant. */
export function usePrefetchReviewDetails() {
  const queryClient = useQueryClient();
  return useCallback(
    (guids: string[]) => {
      for (const guid of guids) {
        void queryClient.prefetchQuery(detailQueryOptions(guid));
      }
    },
    [queryClient],
  );
}

export function useSubmitVerdict() {
  const queryClient = useQueryClient();
  const { applyReviewSync } = useScannedCards();
  return useMutation({
    mutationFn: ({
      guid,
      body,
    }: {
      guid: string;
      body: ReviewVerdictRequest;
    }) => submitVerdict(guid, body),
    onSuccess: (result, { guid, body }) => {
      // Keep the scanner screen's in-memory list in step with what the
      // verdict just did to the collection card.
      if (result.data?.updatedCard) applyReviewSync(result.data.updatedCard);
      // Patch the item in place rather than dropping it: the reviewer may
      // step back to it (z), and removing rows would shift every index the
      // screen is holding. A refetch naturally filters it out later.
      const patch = (item: ReviewQueueItem): ReviewQueueItem =>
        item.guid === guid
          ? {
              ...item,
              reviewedAt: new Date().toISOString(),
              reviewVerdict: body.verdict,
              mismatchReasons: body.mismatchReasons?.length
                ? body.mismatchReasons
                : null,
              correctedCardId:
                body.verdict === "corrected"
                  ? (body.correctedCardId ?? null)
                  : null,
            }
          : item;
      for (const status of ["unreviewed", "reviewed", "all"] as const) {
        queryClient.setQueryData<InfiniteData<ReviewQueuePage>>(
          ["review-queue", status],
          (data) =>
            data && {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                items: page.items.map(patch),
              })),
            },
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["review-stats"] });
      void queryClient.invalidateQueries({ queryKey: ["review-detail", guid] });
    },
  });
}
