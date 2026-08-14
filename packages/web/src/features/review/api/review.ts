import { apiGet, apiPost } from "@/lib/api/client";
import type {
  Result,
  ReviewDetail,
  ReviewQueuePage,
  ReviewStats,
  ReviewVerdictRequest,
  ReviewVerdictResponse,
} from "@poke-sort/shared";

export type ReviewQueueStatus = "unreviewed" | "reviewed" | "all";

export async function getReviewQueue(
  status: ReviewQueueStatus,
  cursor?: string,
  limit = 50,
): Promise<Result<ReviewQueuePage>> {
  const params = new URLSearchParams({ status, limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return apiGet<Result<ReviewQueuePage>>(`/api/review/queue?${params}`);
}

export async function getReviewStats(): Promise<Result<ReviewStats>> {
  return apiGet<Result<ReviewStats>>("/api/review/stats");
}

export async function getReviewDetail(
  guid: string,
): Promise<Result<ReviewDetail>> {
  return apiGet<Result<ReviewDetail>>(`/api/review/${guid}`);
}

export async function submitVerdict(
  guid: string,
  body: ReviewVerdictRequest,
): Promise<Result<ReviewVerdictResponse>> {
  return apiPost<Result<ReviewVerdictResponse>>(
    `/api/review/${guid}/verdict`,
    body,
  );
}
