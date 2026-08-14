import { apiGet, apiPost } from "@/lib/api/client";
import type { DataUsageSnapshot, TrimOutcome, TrimRequest } from "@poke-sort/shared";
import { queryOptions } from "@tanstack/react-query";

export async function getDataUsage(
  refresh = false,
): Promise<{ success: boolean; data?: DataUsageSnapshot }> {
  return apiGet(`/api/data-usage${refresh ? "?refresh=1" : ""}`);
}

export async function trimData(
  request: TrimRequest,
): Promise<{ success: boolean; message?: string; data?: TrimOutcome }> {
  return apiPost("/api/data-usage/trim", request);
}

export const DATA_USAGE_QUERY_KEY = ["data-usage"] as const;

export const dataUsageQueryOptions = () =>
  queryOptions({
    queryKey: DATA_USAGE_QUERY_KEY,
    queryFn: () => getDataUsage().then((r) => r.data ?? null),
    staleTime: 60_000,
    // Never polled and never refetched on focus. Measuring walks the whole
    // data directory and touches the single-threaded database, so a background
    // refetch while the machine is sorting costs the user latency for a number
    // they are not looking at.
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
  });
