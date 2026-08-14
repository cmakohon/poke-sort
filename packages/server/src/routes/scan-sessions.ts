import type {
  CommitScanSessionResponse,
  OpenScanSession,
  PlayingCardWithDistance,
  ScanSession,
  ScannedCard,
} from "@poke-sort/shared";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { authQuery, db, type Transaction } from "../db";
import { collectionCards, collections, scanSessions } from "../db/schema";
import { captureUrl, deleteCaptures, saveCapture } from "../lib/captures";
import { CARD_COLUMNS, toScannedCard } from "../lib/collection-cards";
import { acquireLock, releaseLock } from "../lib/scan-lock";
import { emitToSession } from "../lib/session-stream";
import { parseBody } from "../lib/validate";
import { getUserDisplayName, requireAuth, requireOrg, type AppEnv } from "../middleware/auth";
import { AddScanSchema } from "./collections";

/**
 * Scan sessions — one row per run of the machine.
 *
 * Scanning used to write straight into the active collection, which meant the
 * scan screen was really a collection view and a throwaway run permanently
 * polluted the collection. Cards now stage here (collection_id NULL,
 * session_guid set) and only acquire a collection when the operator commits.
 *
 * scan_events is deliberately untouched by every route in this file: the
 * identify diagnostics and the human review verdicts must survive a discard,
 * because that is the model's training data and it should not depend on
 * whether the operator decided to keep the cards.
 */
const router = new Hono<AppEnv>();

const OpenSessionSchema = z.object({ targetCollectionGuid: z.string().min(1) }).strict();
const TargetSchema = z.object({ collectionGuid: z.string().min(1) }).strict();
const CommitSchema = z.object({ collectionGuid: z.string().min(1) }).strict();

type SessionRow = typeof scanSessions.$inferSelect;

async function findCollection(
  tx: Transaction,
  guid: string,
  orgId: string,
): Promise<{ id: number; guid: string | null; name: string; gameId: number | null; lang: string } | undefined> {
  return tx.query.collections.findFirst({
    where: (t, { and: a, eq: e }) => a(e(t.guid, guid), e(t.orgId, orgId)),
    columns: { id: true, guid: true, name: true, gameId: true, lang: true },
  });
}

/** Hydrates the wire shape, resolving the target collection's guid and name. */
async function toScanSession(tx: Transaction, row: SessionRow): Promise<ScanSession> {
  const target = row.targetCollectionId
    ? await tx.query.collections.findFirst({
        where: (t, { eq: e }) => e(t.id, row.targetCollectionId!),
        columns: { guid: true, name: true },
      })
    : null;
  return {
    guid: row.guid!,
    targetCollectionGuid: target?.guid ?? null,
    targetCollectionName: target?.name ?? null,
    startedAt: row.startedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    outcome: (row.outcome as ScanSession["outcome"]) ?? null,
  };
}

function findOpenSession(tx: Transaction, orgId: string) {
  return tx.query.scanSessions.findFirst({
    where: (t, { and: a, eq: e, isNull: n }) => a(e(t.orgId, orgId), n(t.closedAt)),
  });
}

/** Staged cards belong to a session and to no collection — both halves matter. */
function stagedCardsWhere(sessionGuid: string, orgId: string) {
  return and(
    eq(collectionCards.sessionGuid, sessionGuid),
    isNull(collectionCards.collectionId),
    eq(collectionCards.orgId, orgId),
  );
}

// GET /scan-sessions/open — the resume payload: the open session and its
// staged cards. This is what makes an interrupted run survive a reload.
router.get("/open", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  try {
    const data = await authQuery<OpenScanSession | null>(c.get("jwtClaims"), async (tx) => {
      const row = await findOpenSession(tx, orgId);
      if (!row) return null;
      const rows = await tx
        .select(CARD_COLUMNS)
        .from(collectionCards)
        .where(stagedCardsWhere(row.guid!, orgId))
        .orderBy(desc(collectionCards.scannedAt));
      return { session: await toScanSession(tx, row), cards: rows.map(toScannedCard) };
    });
    return c.json({ success: true, data });
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// POST /scan-sessions/open — get-or-create. Idempotent so the client can call
// it on every scan without a mutex; the partial unique index on (org_id) where
// closed_at is null is what actually settles a race.
router.post("/open", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const parsed = await parseBody(c, OpenSessionSchema);
  if (!parsed.ok) return parsed.response;
  const { targetCollectionGuid } = parsed.data;
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      const existing = await findOpenSession(tx, orgId);
      // An open session keeps its own target; retargeting is an explicit act
      // (PUT /:guid/target), never a side effect of starting to scan.
      if (existing) {
        return {
          success: true as const,
          data: { session: await toScanSession(tx, existing), wasExisting: true },
        };
      }
      const collection = await findCollection(tx, targetCollectionGuid, orgId);
      if (!collection) {
        return { success: false as const, message: "Collection not found." };
      }
      const [row] = await tx
        .insert(scanSessions)
        .values({ orgId, targetCollectionId: collection.id })
        .returning();
      return {
        success: true as const,
        data: { session: await toScanSession(tx, row!), wasExisting: false },
      };
    });
    return c.json(result, result.success ? 200 : 404);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// PUT /scan-sessions/:guid/target — point an open run at a different
// collection. The staged cards stay; only the game/lang context and the
// default save destination move.
router.put("/:guid/target", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const userId = c.get("userId");
  const guid = c.req.param("guid");
  const parsed = await parseBody(c, TargetSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const { result, previousTargetGuid } = await authQuery(c.get("jwtClaims"), async (tx) => {
      const session = await tx.query.scanSessions.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.guid, guid), e(t.orgId, orgId)),
      });
      if (!session) {
        return { result: { success: false as const, message: "Session not found." }, previousTargetGuid: null };
      }
      if (session.closedAt) {
        return { result: { success: false as const, message: "Session is closed." }, previousTargetGuid: null };
      }
      const previous = session.targetCollectionId
        ? await tx.query.collections.findFirst({
            where: (t, { eq: e }) => e(t.id, session.targetCollectionId!),
            columns: { guid: true },
          })
        : null;
      const collection = await findCollection(tx, parsed.data.collectionGuid, orgId);
      if (!collection) {
        return { result: { success: false as const, message: "Collection not found." }, previousTargetGuid: null };
      }
      const [row] = await tx
        .update(scanSessions)
        .set({ targetCollectionId: collection.id })
        .where(eq(scanSessions.id, session.id))
        .returning();
      return {
        result: { success: true as const, data: await toScanSession(tx, row!) },
        previousTargetGuid: previous?.guid ?? null,
      };
    });
    // The lock is keyed on the collection being scanned into; the next staged
    // add re-acquires it on the new target.
    if (result.success && previousTargetGuid) releaseLock(previousTargetGuid, userId);
    return c.json(result, result.success ? 200 : 409);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// POST /scan-sessions/:guid/cards — stage a scan.
//
// Mirrors POST /collections/:guid/cards, minus the collection_id and the
// collections.updated_at bump: nothing has been written to a collection yet.
router.post("/:guid/cards", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const userId = c.get("userId");
  const guid = c.req.param("guid");
  const parsed = await parseBody(c, AddScanSchema);
  if (!parsed.ok) return parsed.response;
  const {
    scanId,
    card,
    scannedAt,
    binNumber,
    capturedImageUrl,
    isFoil,
    alternativeMatches,
    needsReview,
    score,
    margin,
    scanEventId,
  } = parsed.data as unknown as ScannedCard & { margin?: number | null };

  // The target has to be resolved before the lock, because the lock is keyed
  // on the collection being scanned into rather than on the session.
  const session = await db.query.scanSessions.findFirst({
    where: (t, { and: a, eq: e }) => a(e(t.guid, guid), e(t.orgId, orgId)),
  });
  if (!session) return c.json({ success: false, message: "Session not found." }, 404);
  if (session.closedAt) {
    return c.json({ success: false, message: "session_closed" }, 409);
  }
  const target = session.targetCollectionId
    ? await db.query.collections.findFirst({
        where: (t, { eq: e }) => e(t.id, session.targetCollectionId!),
        columns: { guid: true, name: true, gameId: true },
      })
    : null;
  if (!target?.guid) {
    return c.json(
      { success: false, message: "This session has no target collection." },
      409,
    );
  }
  const targetGuid = target.guid;

  const displayName = await getUserDisplayName(userId);
  if (!acquireLock(targetGuid, userId, orgId, displayName)) {
    return c.json(
      {
        success: false,
        message: "Another org member is currently scanning into this collection.",
      },
      423,
    );
  }

  // Written before the row so a failed write cannot leave a row pointing at a
  // missing file. The reverse (orphan file, no row) is only wasted disk.
  const capturedImagePath = await saveCapture(scanId, capturedImageUrl);

  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      // Re-checked inside the transaction: a commit landing between the check
      // above and this insert would otherwise strand the card as a staged row
      // on a closed session, invisible to every screen.
      const fresh = await tx.query.scanSessions.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.guid, guid), e(t.orgId, orgId)),
        columns: { closedAt: true },
      });
      if (!fresh || fresh.closedAt) {
        return { success: false as const, message: "session_closed" };
      }

      await tx
        .insert(collectionCards)
        .values({
          guid: scanId,
          // Staged: no collection until the operator commits the run.
          collectionId: null,
          sessionGuid: guid,
          cardId: (card as PlayingCardWithDistance).id,
          card,
          scannedAt: new Date(scannedAt),
          binNumber: binNumber ?? null,
          capturedImagePath,
          variant: (card as { variant?: string }).variant ?? null,
          needsReview: needsReview ?? null,
          scanScore: score ?? null,
          scanMargin: margin ?? null,
          scanEventGuid: scanEventId ?? null,
          isFoil: isFoil ?? false,
          alternativeMatches: alternativeMatches?.length ? alternativeMatches : null,
          orgId,
        })
        .onConflictDoNothing();

      return {
        success: true as const,
        data: {
          scanId,
          card,
          scannedAt,
          binNumber,
          // The served URL, not the data URL the scanner sent: this object is
          // also broadcast over SSE, and a ~150 KB base64 blob per scan would
          // dominate that stream.
          capturedImageUrl: captureUrl(capturedImagePath) ?? capturedImageUrl,
          isFoil,
          alternativeMatches,
          variant: (card as { variant?: string }).variant,
          needsReview,
          score,
          margin: margin ?? undefined,
        } as ScannedCard,
      };
    });
    // Monitor viewers watch a collection, so a staged run still broadcasts on
    // its target's channel — the run is visibly happening even though nothing
    // has been committed yet.
    if (result.success) emitToSession(targetGuid, "card_added", result.data);
    return c.json(result, result.success ? 200 : 409);
  } catch (err) {
    console.error(err);
    emitToSession(targetGuid, "scan_error", {
      message: "Failed to stage card.",
      timestamp: Date.now(),
    });
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// POST /scan-sessions/:guid/commit — save the run into a collection.
//
// One transaction: the cards acquire a collection_id and the session closes
// together, so a scan racing the commit either lands before it (and is saved)
// or is rejected by the closed-session check above.
router.post("/:guid/commit", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const userId = c.get("userId");
  const guid = c.req.param("guid");
  const parsed = await parseBody(c, CommitSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const { result, targetGuid } = await authQuery(c.get("jwtClaims"), async (tx) => {
      const session = await tx.query.scanSessions.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.guid, guid), e(t.orgId, orgId)),
      });
      if (!session) {
        return { result: { success: false as const, message: "Session not found." }, targetGuid: null };
      }
      if (session.closedAt) {
        return { result: { success: false as const, message: "Session is closed." }, targetGuid: null };
      }
      const dest = await findCollection(tx, parsed.data.collectionGuid, orgId);
      if (!dest) {
        return { result: { success: false as const, message: "Collection not found." }, targetGuid: null };
      }
      const previous = session.targetCollectionId
        ? await tx.query.collections.findFirst({
            where: (t, { eq: e }) => e(t.id, session.targetCollectionId!),
            columns: { guid: true },
          })
        : null;

      const moved = await tx
        .update(collectionCards)
        .set({ collectionId: dest.id })
        .where(stagedCardsWhere(guid, orgId))
        .returning({ id: collectionCards.id });

      await tx
        .update(collections)
        .set({ updatedAt: new Date() })
        .where(eq(collections.id, dest.id));

      await tx
        .update(scanSessions)
        .set({ closedAt: new Date(), outcome: "saved", savedCollectionId: dest.id })
        .where(eq(scanSessions.id, session.id));

      const data: CommitScanSessionResponse = {
        collectionGuid: parsed.data.collectionGuid,
        movedCount: moved.length,
      };
      return { result: { success: true as const, data }, targetGuid: previous?.guid ?? null };
    });
    if (result.success && targetGuid) releaseLock(targetGuid, userId);
    return c.json(result, result.success ? 200 : 409);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// POST /scan-sessions/:guid/discard — throw the run away.
//
// Deletes the staged rows and their per-card captures. scan_events and its
// se-<guid>.jpeg captures are a different table and a different filename and
// are deliberately left alone: a discarded run is still evidence about how the
// identify pipeline behaved, and that is the whole reason staging lives in the
// database instead of in client state.
router.post("/:guid/discard", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const userId = c.get("userId");
  const guid = c.req.param("guid");
  const orphanedCaptures: (string | null)[] = [];
  try {
    const { result, targetGuid, scanIds } = await authQuery(c.get("jwtClaims"), async (tx) => {
      const session = await tx.query.scanSessions.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.guid, guid), e(t.orgId, orgId)),
      });
      if (!session) {
        return { result: { success: false as const, message: "Session not found." }, targetGuid: null, scanIds: [] };
      }
      if (session.closedAt) {
        return { result: { success: false as const, message: "Session is closed." }, targetGuid: null, scanIds: [] };
      }
      const previous = session.targetCollectionId
        ? await tx.query.collections.findFirst({
            where: (t, { eq: e }) => e(t.id, session.targetCollectionId!),
            columns: { guid: true },
          })
        : null;

      const removed = await tx
        .delete(collectionCards)
        .where(stagedCardsWhere(guid, orgId))
        .returning({
          guid: collectionCards.guid,
          capturedImagePath: collectionCards.capturedImagePath,
        });
      orphanedCaptures.push(...removed.map((r) => r.capturedImagePath));

      await tx
        .update(scanSessions)
        .set({ closedAt: new Date(), outcome: "discarded" })
        .where(eq(scanSessions.id, session.id));

      return {
        result: { success: true as const, data: { discardedCount: removed.length } },
        targetGuid: previous?.guid ?? null,
        scanIds: removed.map((r) => r.guid).filter((g): g is string => !!g),
      };
    });
    await deleteCaptures(orphanedCaptures);
    if (result.success && targetGuid) {
      // Clear the run from any monitor watching the target.
      if (scanIds.length) emitToSession(targetGuid, "cards_removed", { scanIds });
      releaseLock(targetGuid, userId);
    }
    return c.json(result, result.success ? 200 : 409);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

export { router as scanSessionsRouter };
