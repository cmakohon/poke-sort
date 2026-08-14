import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { machineEvents, scanEvents } from "../db/schema";
import { deleteCaptures } from "./captures";

/**
 * Boot-time pruning for the observability tables.
 *
 * These tables exist to answer "what went wrong recently", not to be an
 * archive — and the diagnostics captures are the one part of scan_events that
 * costs real disk (~150 KB per scan against a few KB of row). So: serial
 * telemetry keeps two weeks, scan diagnostics keep six months, and accepted
 * scans lose their image (not their numbers) after a month. Rows a human
 * reviewed — confirmed-correct included, not just corrections — are exempt
 * from deletion entirely: they are labelled eval data, the most expensive
 * thing here to regenerate.
 *
 * Best-effort by design: the caller must treat a pruning failure as a warning,
 * never a boot failure.
 */

const MACHINE_EVENT_DAYS = 14;
const SCAN_EVENT_DAYS = 180;
const ACCEPT_CAPTURE_DAYS = 30;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function pruneObservability(): Promise<void> {
  try {
    await db
      .delete(machineEvents)
      .where(lt(machineEvents.ts, daysAgo(MACHINE_EVENT_DAYS)));

    const expired = await db
      .delete(scanEvents)
      .where(
        and(
          lt(scanEvents.createdAt, daysAgo(SCAN_EVENT_DAYS)),
          isNull(scanEvents.correctedCardId),
          isNull(scanEvents.reviewedAt),
        ),
      )
      .returning({ capturePath: scanEvents.capturePath });
    await deleteCaptures(expired.map((r) => r.capturePath));

    // Two steps because RETURNING reflects the post-update row: read the file
    // names first, null the column, then unlink. An unlink failure leaves an
    // orphan file (wasted disk), never a row pointing at nothing.
    const imageExpiredWhere = and(
      eq(scanEvents.tier, "accept"),
      lt(scanEvents.createdAt, daysAgo(ACCEPT_CAPTURE_DAYS)),
      isNull(scanEvents.correctedCardId),
      isNull(scanEvents.reviewedAt),
      sql`${scanEvents.capturePath} IS NOT NULL`,
    );
    const imageExpired = await db
      .select({ capturePath: scanEvents.capturePath })
      .from(scanEvents)
      .where(imageExpiredWhere);
    if (imageExpired.length > 0) {
      await db
        .update(scanEvents)
        .set({ capturePath: null })
        .where(imageExpiredWhere);
      await deleteCaptures(imageExpired.map((r) => r.capturePath));
    }
  } catch (err) {
    console.warn("[retention] pruning failed:", err);
  }
}
