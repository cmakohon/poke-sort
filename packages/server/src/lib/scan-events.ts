import type { IdentifyResult } from "@poke-sort/shared";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { scanEvents } from "../db/schema";

/**
 * The diagnostics side of every identify attempt.
 *
 * identifyCard computes per-signal scores, an OCR reading, and a ranked
 * candidate list for every scan — and until this table existed, all of it
 * evaporated the moment the response left the route. Worse, a no-match scan
 * left no row and no image at all, making the most interesting failures the
 * least inspectable. One row per attempt, every tier, is what accuracy tuning
 * (eval/tune.ts, profiles.ts thresholds) actually needs.
 */

/** Top candidates kept per row — enough to see what decideTier saw without
 *  storing 50 hydrated card objects. */
const CANDIDATES_KEPT = 10;

export function scanEventCaptureName(guid: string): string {
  return `se-${guid}.jpeg`;
}

export async function recordScanEvent(params: {
  guid: string;
  orgId: string;
  collectionGuid?: string;
  gameKey: string;
  lang: string;
  result: IdentifyResult;
  durationMs: number;
  capturePath: string | null;
}): Promise<void> {
  const { result } = params;
  const top = result.candidates[0];
  await db.insert(scanEvents).values({
    guid: params.guid,
    orgId: params.orgId,
    collectionGuid: params.collectionGuid ?? null,
    gameKey: params.gameKey,
    lang: params.lang,
    tier: result.tier,
    score: top?.score ?? null,
    margin: result.margin,
    ocr: result.ocr ?? null,
    candidates: result.candidates.slice(0, CANDIDATES_KEPT).map((c) => ({
      id: c.id,
      name: c.card?.name ?? null,
      distance: c.distance,
      score: c.score,
      signals: c.signals ?? null,
    })),
    stamp: result.stamp ?? null,
    capturePath: params.capturePath,
    durationMs: params.durationMs,
    flippedRetry: result.flippedRetry ?? false,
  });
}

/**
 * Joins a human correction back to the diagnostics row: predicted-vs-actual,
 * the cheapest labelled eval data available. First correction wins, matching
 * the original_card_id provenance rule on collection_cards.
 */
export async function recordCorrection(
  scanEventGuid: string,
  correctedCardId: string,
): Promise<void> {
  await db
    .update(scanEvents)
    .set({ correctedCardId, correctedAt: new Date() })
    .where(eq(scanEvents.guid, scanEventGuid));
}
