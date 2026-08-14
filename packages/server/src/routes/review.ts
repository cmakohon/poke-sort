import type {
  IdentifySignals,
  IdentifyTier,
  MismatchReason,
  OcrReading,
  PlayingCard,
  PlayingCardWithDistance,
  ReviewCandidate,
  ReviewCardSync,
  ReviewDetail,
  ReviewQueueItem,
  ReviewStats,
  ReviewVerdict,
} from "@poke-sort/shared";
import { MISMATCH_REASONS } from "@poke-sort/shared";
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { collectionCards, scanEvents } from "../db/schema";
import { resolveAdapterForGame } from "../lib/card-search/resolve";
import { recordReviewVerdict } from "../lib/scan-events";
import { parseBody } from "../lib/validate";
import { requireAuth, requireOrg, type AppEnv } from "../middleware/auth";

/**
 * The review screen's API: a human walks every identify attempt and records
 * a verdict, turning scan_events into labelled eval data. Product surface,
 * not diagnostics — /api/debug/scan-events stays what curl and an assistant
 * use; this is what the app itself renders.
 *
 * Concurrency stance: a scanner-screen correction and a review verdict can
 * race on the same row; both are last-write-wins and that is acceptable for
 * a single operator. The pipeline's own answer is immutable in the
 * candidates jsonb either way.
 */

const router = new Hono<AppEnv>();

/** Worst-first: uncertain scans are where review effort pays most. */
const tierRank = sql<number>`case ${scanEvents.tier} when 'review' then 0 when 'no-match' then 1 else 2 end`;

export interface ReviewCursor {
  rank: number;
  createdAt: string;
  id: number;
}

/**
 * Postgres timestamptz text, e.g. "2026-08-14 05:30:00.123456+00".
 * The cursor must carry the timestamp exactly as stored: a JS Date only
 * keeps milliseconds, and a truncated microsecond value makes the strict
 * keyset comparison re-include the page-boundary row on every page.
 */
const TIMESTAMPTZ_TEXT =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/;

/**
 * Keyset cursor, not offset: reviewed rows drop out of the default
 * unreviewed filter as the user works, which makes offsets skip items.
 * The triple mirrors the ORDER BY exactly, with rank and timestamp taken
 * from the row the database returned — never recomputed on this side.
 */
export function encodeReviewCursor(cursor: ReviewCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeReviewCursor(raw: string): ReviewCursor | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    if (typeof parsed !== "object" || parsed === null) return null;
    const c = parsed as Record<string, unknown>;
    if (
      typeof c.rank !== "number" ||
      typeof c.createdAt !== "string" ||
      !TIMESTAMPTZ_TEXT.test(c.createdAt) ||
      typeof c.id !== "number"
    ) {
      return null;
    }
    return { rank: c.rank, createdAt: c.createdAt, id: c.id };
  } catch {
    return null;
  }
}

/** Shape of one entry in the scan_events.candidates jsonb array. */
interface StoredCandidate {
  id: string;
  name: string | null;
  distance: number;
  score: number;
  signals: IdentifySignals | null;
}

function storedCandidates(row: { candidates: unknown }): StoredCandidate[] {
  return Array.isArray(row.candidates)
    ? (row.candidates as StoredCandidate[])
    : [];
}

/** The predicted card plus the five alternates the 1–5 hotkeys map to. */
const DETAIL_CANDIDATES = 6;

// GET /api/review/queue?status=unreviewed|reviewed|all&limit=&cursor=
router.get("/queue", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const status = c.req.query("status") ?? "unreviewed";
  if (!["unreviewed", "reviewed", "all"].includes(status)) {
    return c.json({ success: false, message: "Invalid status filter." }, 400);
  }
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 100);
  const cursorRaw = c.req.query("cursor");
  const cursor = cursorRaw ? decodeReviewCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) {
    return c.json({ success: false, message: "Invalid cursor." }, 400);
  }

  const conditions = [
    eq(scanEvents.orgId, orgId),
    status === "unreviewed" ? isNull(scanEvents.reviewedAt) : undefined,
    status === "reviewed" ? isNotNull(scanEvents.reviewedAt) : undefined,
    cursor
      ? sql`(${tierRank}, ${scanEvents.createdAt}, ${scanEvents.id}) > (${cursor.rank}, ${cursor.createdAt}::timestamptz, ${cursor.id})`
      : undefined,
  ].filter((f) => f !== undefined);

  // Scalars plus candidates->0 only. The full candidates jsonb stays out of
  // the listing on purpose: PGlite runs on the main thread, and the queue is
  // polled while the machine may be sorting.
  const rows = await db
    .select({
      id: scanEvents.id,
      rank: tierRank,
      // ::text keeps the full microsecond precision for the cursor; the
      // Date object below is only for the client-facing ISO string.
      createdAtText: sql<string>`${scanEvents.createdAt}::text`,
      guid: scanEvents.guid,
      tier: scanEvents.tier,
      gameKey: scanEvents.gameKey,
      lang: scanEvents.lang,
      collectionGuid: scanEvents.collectionGuid,
      score: scanEvents.score,
      margin: scanEvents.margin,
      predictedId: sql<string | null>`${scanEvents.candidates}->0->>'id'`,
      predictedName: sql<string | null>`${scanEvents.candidates}->0->>'name'`,
      capturePath: scanEvents.capturePath,
      createdAt: scanEvents.createdAt,
      reviewedAt: scanEvents.reviewedAt,
      reviewVerdict: scanEvents.reviewVerdict,
      mismatchReasons: scanEvents.mismatchReasons,
      correctedCardId: scanEvents.correctedCardId,
    })
    .from(scanEvents)
    .where(and(...conditions))
    .orderBy(asc(tierRank), asc(scanEvents.createdAt), asc(scanEvents.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  const items: ReviewQueueItem[] = page.map((row) => ({
    guid: row.guid ?? "",
    tier: row.tier as IdentifyTier,
    gameKey: row.gameKey,
    lang: row.lang,
    collectionGuid: row.collectionGuid,
    score: row.score,
    margin: row.margin,
    predictedId: row.predictedId,
    predictedName: row.predictedName,
    capturePath: row.capturePath,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewVerdict: row.reviewVerdict as ReviewVerdict | null,
    mismatchReasons: row.mismatchReasons as MismatchReason[] | null,
    correctedCardId: row.correctedCardId,
  }));

  const nextCursor =
    hasMore && last
      ? encodeReviewCursor({
          rank: Number(last.rank),
          createdAt: last.createdAtText,
          id: last.id,
        })
      : null;

  return c.json({ success: true, data: { items, nextCursor } });
});

// GET /api/review/stats — queue counts for the header / nav badge.
router.get("/stats", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const unreviewedRows = await db
    .select({ tier: scanEvents.tier, total: count() })
    .from(scanEvents)
    .where(and(eq(scanEvents.orgId, orgId), isNull(scanEvents.reviewedAt)))
    .groupBy(scanEvents.tier);
  const [reviewedRow] = await db
    .select({ total: count() })
    .from(scanEvents)
    .where(and(eq(scanEvents.orgId, orgId), isNotNull(scanEvents.reviewedAt)));

  const stats: ReviewStats = {
    unreviewed: { accept: 0, review: 0, "no-match": 0 },
    reviewed: reviewedRow?.total ?? 0,
  };
  for (const row of unreviewedRows) {
    if (row.tier in stats.unreviewed) {
      stats.unreviewed[row.tier as IdentifyTier] = row.total;
    }
  }
  return c.json({ success: true, data: stats });
});

// GET /api/review/:guid — full row with the top candidates hydrated to real
// cards. Hydration happens here, not in the queue: five cached catalog
// lookups per item the moment it is viewed (the client prefetches the next
// couple) instead of hundreds per queue page.
router.get("/:guid", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const guid = c.req.param("guid");
  const row = await db.query.scanEvents.findFirst({
    where: (t, { and, eq }) => and(eq(t.guid, guid), eq(t.orgId, orgId)),
  });
  if (!row) {
    return c.json({ success: false, message: "Scan event not found." }, 404);
  }

  const top = storedCandidates(row).slice(0, DETAIL_CANDIDATES);
  const resolved = await resolveAdapterForGame(row.gameKey);
  // allSettled + per-candidate null: a catalog id that no longer hydrates
  // (resync, adapter down) renders as a name-only tile. Art must never block
  // a verdict.
  const hydrations = resolved
    ? await Promise.allSettled(
        top.map((cand) =>
          resolved.adapter.searchById(cand.id, resolved.baseUrl),
        ),
      )
    : [];
  const candidates: ReviewCandidate[] = top.map((cand, i) => {
    const outcome = hydrations[i];
    const card =
      outcome?.status === "fulfilled" && outcome.value.success
        ? (outcome.value.data ?? null)
        : null;
    return {
      id: cand.id,
      name: cand.name ?? null,
      distance: cand.distance,
      score: cand.score,
      signals: cand.signals ?? null,
      card,
    };
  });

  const linked = await db.query.collectionCards.findFirst({
    where: (t, { and, eq }) =>
      and(eq(t.scanEventGuid, guid), eq(t.orgId, orgId)),
    columns: { id: true },
  });

  const detail: ReviewDetail = {
    guid: row.guid ?? "",
    tier: row.tier as IdentifyTier,
    gameKey: row.gameKey,
    lang: row.lang,
    collectionGuid: row.collectionGuid,
    score: row.score,
    margin: row.margin,
    predictedId: top[0]?.id ?? null,
    predictedName: top[0]?.name ?? null,
    capturePath: row.capturePath,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewVerdict: row.reviewVerdict as ReviewVerdict | null,
    mismatchReasons: row.mismatchReasons as MismatchReason[] | null,
    correctedCardId: row.correctedCardId,
    ocr: (row.ocr as OcrReading | null) ?? null,
    candidates,
    reviewNote: row.reviewNote,
    hasLinkedCard: linked !== undefined,
  };
  return c.json({ success: true, data: detail });
});

export const VerdictSchema = z
  .object({
    verdict: z.enum(["correct", "corrected", "unresolvable"]),
    correctedCardId: z.string().min(1).optional(),
    mismatchReasons: z.array(z.enum(MISMATCH_REASONS)).max(MISMATCH_REASONS.length).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.verdict === "corrected") {
      if (!val.correctedCardId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["correctedCardId"],
          message: "Required when verdict is corrected.",
        });
      }
      if (!val.mismatchReasons?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mismatchReasons"],
          message: "At least one reason is required when verdict is corrected.",
        });
      }
    } else if (val.correctedCardId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["correctedCardId"],
        message: `Not allowed when verdict is ${val.verdict}.`,
      });
    }
    // "correct" MAY carry reasons: the identity was right but something
    // about the printing was not (wrong-variant — league stamps and the
    // like often have no catalog entry to correct to). Identity-level eval
    // still counts these as hits; the reasons flag the variant miss.
  });

// POST /api/review/:guid/verdict
router.post("/:guid/verdict", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const guid = c.req.param("guid");
  const parsed = await parseBody(c, VerdictSchema);
  if (!parsed.ok) return parsed.response;
  const { verdict, correctedCardId, mismatchReasons, note } = parsed.data;

  const row = await db.query.scanEvents.findFirst({
    where: (t, { and, eq }) => and(eq(t.guid, guid), eq(t.orgId, orgId)),
    columns: {
      guid: true,
      gameKey: true,
      candidates: true,
      correctedCardId: true,
      collectionGuid: true,
    },
  });
  if (!row) {
    return c.json({ success: false, message: "Scan event not found." }, 404);
  }

  if (verdict === "correct" && storedCandidates(row).length === 0) {
    return c.json(
      {
        success: false,
        message:
          "This scan produced no candidates — there is no prediction to confirm.",
      },
      422,
    );
  }

  // Hydrate the truth card before touching the DB: it is an HTTP call, and
  // the single-connection PGlite client must never be re-entered mid-write.
  // It also validates the id — a typo'd correction must fail here, not
  // poison the eval data.
  let truthCard: PlayingCard | null = null;
  if (verdict === "corrected" && correctedCardId) {
    const resolved = await resolveAdapterForGame(row.gameKey);
    if (!resolved) {
      return c.json(
        { success: false, message: `No card catalog for game "${row.gameKey}".` },
        422,
      );
    }
    const result = await resolved.adapter
      .searchById(correctedCardId, resolved.baseUrl)
      .catch(() => null);
    if (!result?.success || !result.data) {
      return c.json(
        { success: false, message: `Card "${correctedCardId}" not found in catalog.` },
        422,
      );
    }
    truthCard = result.data;
  }

  try {
    await recordReviewVerdict({
      scanEventGuid: guid,
      verdict,
      correctedCardId,
      mismatchReasons,
      note,
    });
  } catch (err) {
    console.error("[review] verdict write failed:", err);
    return c.json({ success: false, message: "Database error." }, 500);
  }

  // Best-effort propagation to the linked collection card, so the collection
  // does not drift from the reviewed truth. Missing card is normal (no
  // collection active at scan time, card deleted since). bin_number is left
  // alone on purpose: it records where the card physically went.
  //
  // hadCorrection means a prior correction may have been propagated; a
  // verdict that leaves the corrected state must also unwind the card, or
  // the collection would keep the retracted answer forever.
  const hadCorrection = row.correctedCardId != null;
  let propagated = false;
  let updatedCard: ReviewCardSync | undefined;
  try {
    const existing = await db.query.collectionCards.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.scanEventGuid, guid), eq(t.orgId, orgId)),
      columns: {
        id: true,
        guid: true,
        cardId: true,
        card: true,
        wasCorrected: true,
        scanScore: true,
        originalCardId: true,
        originalDistance: true,
        originalScore: true,
        // Where the card lives now. NULL means it is still staged on an open
        // scan session; the client patches a different cache in that case.
        collectionId: true,
      },
    });
    if (existing) {
      // Every verdict stamps the card's review state — the scan screen's
      // "reviewed" badge — and sets needsReview to match: a judged card is
      // out of the review queue unless the judgment was "identity unknown".
      const updates: Partial<typeof collectionCards.$inferInsert> = {
        reviewedAt: new Date(),
        reviewVerdict: verdict,
        needsReview: verdict === "unresolvable",
      };
      if (verdict === "corrected" && truthCard) {
        updates.card = { ...truthCard, distance: 0 };
        updates.cardId = truthCard.id;
        // Same first-correction rule as the collections route: original_*
        // holds what the pipeline predicted, never a human's earlier answer.
        if (!existing.wasCorrected) {
          const prevDistance = (existing.card as { distance?: number } | null)
            ?.distance;
          updates.wasCorrected = true;
          updates.originalCardId = existing.cardId;
          updates.originalDistance =
            typeof prevDistance === "number" ? prevDistance : null;
          updates.originalScore = existing.scanScore ?? null;
        }
      } else if (
        verdict !== "corrected" &&
        hadCorrection &&
        existing.wasCorrected &&
        existing.originalCardId
      ) {
        // Leaving the corrected state: restore the pipeline's original pick
        // and clear the provenance the correction wrote, so card and verdict
        // tell the same story again.
        const resolved = await resolveAdapterForGame(row.gameKey);
        const original = resolved
          ? await resolved.adapter
              .searchById(existing.originalCardId, resolved.baseUrl)
              .catch(() => null)
          : null;
        if (original?.success && original.data) {
          updates.card = {
            ...original.data,
            distance: existing.originalDistance ?? 0,
          };
          updates.cardId = existing.originalCardId;
          updates.wasCorrected = false;
          updates.originalCardId = null;
          updates.originalDistance = null;
          updates.originalScore = null;
        } else {
          console.warn(
            `[review] could not rehydrate original card ${existing.originalCardId}; leaving collection card as-is`,
          );
        }
      }
      await db
        .update(collectionCards)
        .set(updates)
        .where(eq(collectionCards.id, existing.id));
      propagated = true;
      // Where the card lives *now*, which is not row.collectionGuid — that is
      // scan_events.collection_guid, the collection the run was aimed at when
      // the scan happened. A staged card has no collection yet, and a saved
      // one may have been committed somewhere else entirely.
      const owner = existing.collectionId
        ? await db.query.collections.findFirst({
            where: (t, { eq }) => eq(t.id, existing.collectionId!),
            columns: { guid: true },
          })
        : null;
      updatedCard = {
        scanId: existing.guid ?? "",
        collectionGuid: owner?.guid ?? null,
        isStaged: existing.collectionId == null,
        card: updates.card as PlayingCardWithDistance | undefined,
        needsReview: updates.needsReview ?? false,
        wasCorrected: updates.wasCorrected ?? existing.wasCorrected,
        originalCardId:
          "originalCardId" in updates
            ? (updates.originalCardId ?? null)
            : existing.originalCardId,
        originalDistance:
          "originalDistance" in updates
            ? (updates.originalDistance ?? null)
            : existing.originalDistance,
        originalScore:
          "originalScore" in updates
            ? (updates.originalScore ?? null)
            : existing.originalScore,
        reviewVerdict: verdict,
      };
    }
  } catch (err) {
    console.error("[review] collection card propagation failed:", err);
  }

  return c.json({ success: true, data: { guid, verdict, propagated, updatedCard } });
});

export { router as reviewRouter };
