import type {
  Collection,
  FieldMeta,
  PlayingCardWithDistance,
  ScannedCard,
} from "@poke-sort/shared";
import { LOCAL_ORG_ID, LOCAL_USER_ID } from "@poke-sort/shared";
import { and, count, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { parseBody } from "../lib/validate";

/**
 * The identified card, as stored.
 *
 * `.passthrough()` on purpose: this object is the upstream TCGdex card and goes
 * into a jsonb column whole, where the bin rule engine resolves paths against
 * it. Enumerating TCGdex's shape here would mean re-declaring someone else's
 * API and breaking every time they add a field. What is pinned is the handful
 * of properties this codebase actually reads.
 */
const CardSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    distance: z.number().optional(),
  })
  .passthrough();

export const AddScanSchema = z
  .object({
    scanId: z.string().min(1),
    card: CardSchema,
    scannedAt: z.union([z.string(), z.number()]),
    binNumber: z.number().int().nullable().optional(),
    // A data URL that gets decoded and written to disk; capped so a scan cannot
    // be used to write an arbitrarily large file.
    capturedImageUrl: z.string().max(20_000_000).nullable().optional(),
    isFoil: z.boolean().optional(),
    alternativeMatches: z.array(CardSchema).nullable().optional(),
  })
  .passthrough();

export const UpdateScanSchema = z
  .object({
    card: CardSchema.optional(),
    binNumber: z.number().int().nullable().optional(),
    isFoil: z.boolean().optional(),
    variant: z.string().optional(),
    originalCardId: z.string().optional(),
    originalDistance: z.number().optional(),
    originalScore: z.number().optional(),
    wasCorrected: z.boolean().optional(),
  })
  .strict();

const NameSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();

export const CreateCollectionSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    gameGuid: z.string().min(1).optional(),
    lang: z.string().min(1).max(16).optional(),
  })
  .strict();

/**
 * Bulk operations take scan guids.
 *
 * The client does not batch: "select all" sends every id in the collection in
 * one request, so this has to clear a whole sorting session, not a screenful.
 * 100k guids is ~3.6 MB of body — still a bound, but one no real session hits.
 */
export const ScanIdsSchema = z
  .object({ scanIds: z.array(z.string().min(1)).min(1).max(100_000) })
  .strict();

import { streamSSE } from "hono/streaming";
import { authQuery, db, type Transaction } from "../db";
import { collectionCards, collections, games, orgSettings } from "../db/schema";
import {
  captureUrl,
  deleteCaptures,
  saveCapture,
} from "../lib/captures";
import { buildCardScannedEmbed, sendDiscordNotification } from "../lib/discord";
import {
  acquireLock,
  getLocksForGuids,
  releaseLock,
  subscribeOrgLocks,
} from "../lib/scan-lock";
import {
  emitToSession,
  getSessionViewers,
  sessionListenerCount,
  subscribeSession,
} from "../lib/session-stream";
import {
  getUserDisplayName,
  LOCAL_JWT_CLAIMS,
  requireAuth,
  requireOrg,
  type AppEnv,
} from "../middleware/auth";

const router = new Hono<AppEnv>();

function toCollection(row: {
  guid: string | null;
  name: string;
  isActive: boolean;
  cardCount: string | number;
  lang: string;
  createdAt: Date;
  updatedAt: Date;
  gameGuid: string | null;
  gameKey: string | null;
  gameName: string | null;
  gameDataSourceUrl: string | null;
  gameIsActive: boolean | null;
  gameFieldDefinitions: unknown;
  gameCreatedAt: Date | null;
  gameUpdatedAt: Date | null;
}): Collection {
  return {
    guid: row.guid!,
    name: row.name,
    isActive: row.isActive,
    cardCount: Number(row.cardCount),
    lang: row.lang,
    game: row.gameGuid
      ? {
          guid: row.gameGuid,
          key: row.gameKey!,
          name: row.gameName!,
          dataSourceUrl: row.gameDataSourceUrl!,
          isActive: row.gameIsActive!,
          fieldDefinitions: row.gameFieldDefinitions as FieldMeta[],
          createdAt: row.gameCreatedAt!,
          updatedAt: row.gameUpdatedAt!,
        }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toScannedCard(row: {
  guid: string | null;
  card: unknown;
  scannedAt: Date;
  capturedImagePath?: string | null;
  capturedImageDataUrl?: string | null;
  binNumber: number | null;
  isFoil?: boolean | null;
  isDownloaded?: boolean | null;
  alternativeMatches?: unknown;
  variant?: string | null;
  originalCardId?: string | null;
  originalDistance?: number | null;
  originalScore?: number | null;
  wasCorrected?: boolean | null;
}): ScannedCard {
  return {
    scanId: row.guid!,
    card: row.card as PlayingCardWithDistance,
    scannedAt: row.scannedAt.getTime(),
    binNumber: row.binNumber ?? undefined,
    // Prefer the file; fall back to any legacy inline data URL.
    capturedImageUrl:
      captureUrl(row.capturedImagePath) ??
      row.capturedImageDataUrl ??
      undefined,
    isFoil: row.isFoil ?? undefined,
    isDownloaded: row.isDownloaded ?? undefined,
    alternativeMatches:
      (row.alternativeMatches as PlayingCardWithDistance[] | null) ?? undefined,
    variant: row.variant ?? undefined,
    originalCardId: row.originalCardId ?? undefined,
    originalDistance: row.originalDistance ?? undefined,
    originalScore: row.originalScore ?? undefined,
    wasCorrected: row.wasCorrected ?? undefined,
  };
}

async function _loadCollections(
  tx: Transaction,
  orgId: string,
): Promise<{ success: true; data: Collection[] }> {
  const rows = await tx
    .select({
      id: collections.id,
      guid: collections.guid,
      name: collections.name,
      isActive: collections.isActive,
      cardCount: count(collectionCards.id),
      lang: collections.lang,
      createdAt: collections.createdAt,
      updatedAt: collections.updatedAt,
      gameGuid: games.guid,
      gameKey: games.key,
      gameName: games.name,
      gameDataSourceUrl: games.dataSourceUrl,
      gameIsActive: games.isActive,
      gameFieldDefinitions: games.fieldDefinitions,
      gameCreatedAt: games.createdAt,
      gameUpdatedAt: games.updatedAt,
    })
    .from(collections)
    .leftJoin(collectionCards, eq(collectionCards.collectionId, collections.id))
    .leftJoin(games, eq(games.id, collections.gameId))
    .where(eq(collections.orgId, orgId))
    .groupBy(
      collections.id,
      collections.guid,
      collections.name,
      collections.isActive,
      collections.lang,
      collections.createdAt,
      collections.updatedAt,
      games.id,
    )
    .orderBy(desc(collections.updatedAt));

  return { success: true, data: rows.map(toCollection) };
}

// GET /collections
router.get("/", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  try {
    const result = await authQuery(c.get("jwtClaims"), (tx) =>
      _loadCollections(tx, orgId),
    );
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// GET /collections/lock-events — SSE stream of lock_acquired / lock_released for all local collections
router.get("/lock-events", async (c) => {
  const orgId = LOCAL_ORG_ID;
  const jwtClaims = LOCAL_JWT_CLAIMS;

  return streamSSE(c, async (stream) => {
    // Send current lock state as initial event
    try {
      const guids = await authQuery(jwtClaims, async (tx) =>
        tx
          .select({ guid: collections.guid })
          .from(collections)
          .where(eq(collections.orgId, orgId)),
      );
      const initial = getLocksForGuids(
        guids.map((r) => r.guid!).filter(Boolean),
      );
      await stream.writeSSE({
        event: "init",
        data: JSON.stringify({ locks: initial }),
      });
    } catch {
      /* non-fatal */
    }

    const unsubscribe = subscribeOrgLocks(orgId, (event, data) => {
      stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {});
    });

    await new Promise<void>((resolve) => {
      stream.onAbort(resolve);
    });
    unsubscribe();
  });
});

// GET /collections/locks — returns { [guid]: ScanLock } for collections currently locked by a scanner
router.get("/locks", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  try {
    const guids = await authQuery(c.get("jwtClaims"), async (tx) =>
      tx
        .select({ guid: collections.guid })
        .from(collections)
        .where(eq(collections.orgId, orgId)),
    );
    const data = getLocksForGuids(guids.map((r) => r.guid!).filter(Boolean));
    return c.json({ success: true, data });
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// GET /collections/live — returns { [guid]: monitorCount } for sessions with active monitors
router.get("/live", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  try {
    const allCollections = await authQuery(c.get("jwtClaims"), async (tx) => {
      return tx
        .select({ guid: collections.guid })
        .from(collections)
        .where(eq(collections.orgId, orgId));
    });

    const live: Record<string, number> = {};
    for (const { guid } of allCollections) {
      if (!guid) continue;
      const n = sessionListenerCount(guid);
      if (n > 0) live[guid] = n;
    }

    return c.json({ success: true, data: live });
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// GET /collections/viewers — viewers for all collections { [guid]: ViewerInfo[] }
router.get("/viewers", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const allCollections = await authQuery(c.get("jwtClaims"), async (tx) =>
    tx
      .select({ guid: collections.guid })
      .from(collections)
      .where(eq(collections.orgId, orgId)),
  );
  const result: Record<string, ReturnType<typeof getSessionViewers>> = {};
  for (const { guid } of allCollections) {
    if (!guid) continue;
    const viewers = getSessionViewers(guid);
    if (viewers.length > 0) result[guid] = viewers;
  }
  return c.json({ success: true, data: result });
});

// GET /collections/:guid/viewers — current session viewers for a collection
router.get("/:guid/viewers", requireAuth, requireOrg, async (c) => {
  const guid = c.req.param("guid");
  return c.json({ success: true, data: getSessionViewers(guid) });
});

// POST /collections — create and activate
router.post("/", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const parsed = await parseBody(c, CreateCollectionSchema);
  if (!parsed.ok) return parsed.response;
  const { name, gameGuid, lang } = parsed.data;
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      let gameId: number | null = null;
      if (gameGuid) {
        const game = await tx.query.games.findFirst({
          where: (t, { eq }) => eq(t.guid, gameGuid),
          columns: { id: true },
        });
        gameId = game?.id ?? null;
      }

      await tx
        .update(collections)
        .set({ isActive: false })
        .where(
          and(eq(collections.isActive, true), eq(collections.orgId, orgId)),
        );

      await tx
        .insert(collections)
        .values({ name, isActive: true, orgId, gameId, lang: lang || "en" });

      return _loadCollections(tx, orgId);
    });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// PUT /collections/:guid — rename
router.put("/:guid", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const guid = c.req.param("guid");
  const parsed = await parseBody(c, NameSchema);
  if (!parsed.ok) return parsed.response;
  const { name } = parsed.data;
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      const target = await tx.query.collections.findFirst({
        where: (t, { eq, and }) => and(eq(t.guid, guid), eq(t.orgId, orgId)),
        columns: { id: true },
      });
      if (!target) return { success: false, message: "Collection not found." };
      await tx
        .update(collections)
        .set({ name, updatedAt: new Date() })
        .where(eq(collections.id, target.id));
      return _loadCollections(tx, orgId);
    });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// PUT /collections/:guid/active — activate
router.put("/:guid/active", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const guid = c.req.param("guid");
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      const target = await tx.query.collections.findFirst({
        where: (t, { eq, and }) => and(eq(t.guid, guid), eq(t.orgId, orgId)),
        columns: { id: true },
      });
      if (!target) return { success: false, message: "Collection not found." };

      await tx
        .update(collections)
        .set({ isActive: false })
        .where(
          and(eq(collections.isActive, true), eq(collections.orgId, orgId)),
        );
      await tx
        .update(collections)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(collections.id, target.id));

      return _loadCollections(tx, orgId);
    });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// DELETE /collections/:guid
router.delete("/:guid", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const guid = c.req.param("guid");
  const orphanedCaptures: (string | null)[] = [];
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      const target = await tx.query.collections.findFirst({
        where: (t, { eq, and }) => and(eq(t.guid, guid), eq(t.orgId, orgId)),
        columns: { id: true, isActive: true },
      });
      if (!target) return { success: false, message: "Collection not found." };

      // Rows cascade via FK, but files do not — collect the paths first.
      const doomed = await tx
        .select({ capturedImagePath: collectionCards.capturedImagePath })
        .from(collectionCards)
        .where(eq(collectionCards.collectionId, target.id));
      orphanedCaptures.push(...doomed.map((r) => r.capturedImagePath));

      // cascade deletes collectionCards via FK
      await tx.delete(collections).where(eq(collections.id, target.id));

      // if we deleted the active one, activate the most recent remaining
      if (target.isActive) {
        const next = await tx.query.collections.findFirst({
          where: (t, { eq }) => eq(t.orgId, orgId),
          orderBy: (t, { desc }) => [desc(t.updatedAt)],
          columns: { id: true },
        });
        if (next) {
          await tx
            .update(collections)
            .set({ isActive: true })
            .where(eq(collections.id, next.id));
        }
      }

      return _loadCollections(tx, orgId);
    });
    await deleteCaptures(orphanedCaptures);
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// GET /collections/:guid/cards
router.get("/:guid/cards", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const guid = c.req.param("guid");
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      const collection = await tx.query.collections.findFirst({
        where: (t, { eq, and }) => and(eq(t.guid, guid), eq(t.orgId, orgId)),
        columns: { id: true },
      });
      if (!collection)
        return { success: false, message: "Collection not found." };

      const rows = await tx
        .select({
          guid: collectionCards.guid,
          card: collectionCards.card,
          scannedAt: collectionCards.scannedAt,
          binNumber: collectionCards.binNumber,
          capturedImagePath: collectionCards.capturedImagePath,
          capturedImageDataUrl: collectionCards.capturedImageDataUrl,
          isFoil: collectionCards.isFoil,
          isDownloaded: collectionCards.isDownloaded,
          alternativeMatches: collectionCards.alternativeMatches,
          variant: collectionCards.variant,
          originalCardId: collectionCards.originalCardId,
          originalDistance: collectionCards.originalDistance,
          originalScore: collectionCards.originalScore,
          wasCorrected: collectionCards.wasCorrected,
        })
        .from(collectionCards)
        .where(eq(collectionCards.collectionId, collection.id))
        .orderBy(desc(collectionCards.scannedAt));

      return { success: true, data: rows.map(toScannedCard) };
    });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// POST /collections/:guid/cards — add card
router.post("/:guid/cards", requireAuth, requireOrg, async (c) => {
  const guid = c.req.param("guid");
  const userId = c.get("userId");
  const orgId = c.get("orgId");
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
  } = parsed.data as unknown as ScannedCard;

  const displayName = await getUserDisplayName(userId);
  if (!acquireLock(guid, userId, orgId, displayName)) {
    return c.json(
      {
        success: false,
        message:
          "Another org member is currently scanning into this collection.",
      },
      423,
    );
  }

  type AddCardResult =
    | { success: true; data: ScannedCard }
    | { success: false; message: string };

  // Written before the row so a failed write cannot leave a row pointing at a
  // missing file. The reverse (orphan file, no row) is only wasted disk.
  const capturedImagePath = await saveCapture(scanId, capturedImageUrl);

  try {
    const { result, collectionName, gameName } = await authQuery<{
      result: AddCardResult;
      collectionName: string | undefined;
      gameName: string | undefined;
    }>(c.get("jwtClaims"), async (tx) => {
      const collection = await tx.query.collections.findFirst({
        where: (t, { eq, and }) => and(eq(t.guid, guid), eq(t.orgId, orgId)),
        columns: { id: true, gameId: true, name: true },
      });
      if (!collection)
        return {
          result: { success: false, message: "Collection not found." },
          collectionName: undefined,
          gameName: undefined,
        };

      await tx
        .insert(collectionCards)
        .values({
          guid: scanId,
          collectionId: collection.id,
          cardId: (card as PlayingCardWithDistance).id,
          card,
          scannedAt: new Date(scannedAt),
          binNumber: binNumber ?? null,
          capturedImagePath,
          // The identify pipeline stamps the winner's card with the detected
          // printing; keep it as a column so bin rules and exports see it.
          variant: (card as { variant?: string }).variant ?? null,
          isFoil: isFoil ?? false,
          alternativeMatches: alternativeMatches?.length
            ? alternativeMatches
            : null,
          orgId,
        })
        .onConflictDoNothing();

      await tx
        .update(collections)
        .set({ updatedAt: new Date() })
        .where(eq(collections.id, collection.id));

      const game = collection.gameId
        ? await tx.query.games.findFirst({
            where: (t, { eq }) => eq(t.id, collection.gameId!),
            columns: { name: true },
          })
        : null;

      return {
        result: {
          success: true,
          data: {
            scanId,
            card,
            scannedAt,
            binNumber,
            // The served URL, not the data URL the scanner sent: this object is
            // also broadcast over SSE to monitor viewers, and a ~150 KB base64
            // blob per scan would dominate that stream.
            capturedImageUrl:
              captureUrl(capturedImagePath) ?? capturedImageUrl,
            isFoil,
            alternativeMatches,
          } as ScannedCard,
        },
        collectionName: collection.name,
        gameName: game?.name,
      };
    });
    if (result.success) {
      emitToSession(guid, "card_added", result.data);

      db.query.orgSettings
        .findFirst({
          where: eq(orgSettings.orgId, orgId),
          columns: { discordNotifyOnScan: true },
        })
        .then((row) => {
          if (row?.discordNotifyOnScan) {
            void sendDiscordNotification(
              orgId,
              buildCardScannedEmbed(card as PlayingCardWithDistance, {
                isFoil,
                collectionName,
                gameName,
                collectionGuid: guid,
              }),
            );
          }
        })
        .catch((err) => {
          console.error("[discord] Failed to check discordNotifyOnScan:", err);
        });
    }
    return c.json(result);
  } catch (err) {
    console.error(err);
    emitToSession(guid, "scan_error", {
      message: "Failed to save card to collection.",
      timestamp: Date.now(),
    });
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// PUT /collections/:guid/cards/:scanId — update card (correction and/or foil status)
router.put("/:guid/cards/:scanId", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const { guid, scanId } = c.req.param();
  const parsedUpdate = await parseBody(c, UpdateScanSchema);
  if (!parsedUpdate.ok) return parsedUpdate.response;
  const {
    card,
    binNumber,
    isFoil,
    variant,
    originalCardId,
    originalDistance,
    originalScore,
    wasCorrected,
  } = parsedUpdate.data as {
    card?: PlayingCardWithDistance;
    binNumber?: number;
    isFoil?: boolean;
    variant?: string;
    originalCardId?: string;
    originalDistance?: number;
    originalScore?: number;
    wasCorrected?: boolean;
  };
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      const existing = await tx.query.collectionCards.findFirst({
        where: (t, { eq, and }) => and(eq(t.guid, scanId), eq(t.orgId, orgId)),
        columns: {
          id: true,
          scannedAt: true,
          card: true,
          binNumber: true,
          isFoil: true,
          wasCorrected: true,
        },
      });
      if (!existing) return { success: false, message: "Card not found." };

      const updates: Partial<typeof collectionCards.$inferInsert> = {};
      if (card !== undefined) {
        updates.card = card;
        updates.cardId = card.id;
        updates.binNumber = binNumber ?? null;
      }
      if (isFoil !== undefined) updates.isFoil = isFoil;
      if (variant !== undefined) updates.variant = variant;

      // Written once, on the first correction: what the pipeline had predicted
      // before a human overruled it. Overwriting on a second correction would
      // replace the model's answer with the human's previous one.
      if (wasCorrected && !existing.wasCorrected) {
        updates.wasCorrected = true;
        updates.originalCardId = originalCardId ?? null;
        updates.originalDistance = originalDistance ?? null;
        updates.originalScore = originalScore ?? null;
      }

      await tx
        .update(collectionCards)
        .set(updates)
        .where(eq(collectionCards.id, existing.id));

      return {
        success: true,
        data: toScannedCard({
          guid: scanId,
          card: (card ?? existing.card) as PlayingCardWithDistance,
          scannedAt: existing.scannedAt,
          binNumber:
            card !== undefined ? (binNumber ?? null) : existing.binNumber,
          isFoil: isFoil !== undefined ? isFoil : existing.isFoil,
        }),
      };
    });
    if (result.success) emitToSession(guid, "card_updated", result.data);
    return c.json(result);
  } catch (err) {
    console.error(err);
    emitToSession(guid, "scan_error", {
      message: "Failed to update card.",
      timestamp: Date.now(),
    });
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// DELETE /collections/:guid/cards — clear all cards in collection
router.delete("/:guid/cards", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const guid = c.req.param("guid");
  const orphanedCaptures: (string | null)[] = [];
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      const collection = await tx.query.collections.findFirst({
        where: (t, { eq, and }) => and(eq(t.guid, guid), eq(t.orgId, orgId)),
        columns: { id: true },
      });
      if (!collection)
        return { success: false, message: "Collection not found." };

      const removed = await tx
        .delete(collectionCards)
        .where(eq(collectionCards.collectionId, collection.id))
        .returning({ capturedImagePath: collectionCards.capturedImagePath });
      orphanedCaptures.push(...removed.map((r) => r.capturedImagePath));

      return { success: true, data: null };
    });
    await deleteCaptures(orphanedCaptures);
    if (result.success) emitToSession(guid, "cards_cleared", {});
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// POST /collections/:guid/cards/remove-bulk — remove multiple cards
router.post("/:guid/cards/remove-bulk", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const guid = c.req.param("guid");
  const parsed = await parseBody(c, ScanIdsSchema);
  if (!parsed.ok) return parsed.response;
  const { scanIds } = parsed.data;
  const orphanedCaptures: (string | null)[] = [];
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      for (const scanId of scanIds) {
        const removed = await tx
          .delete(collectionCards)
          .where(
            and(
              eq(collectionCards.guid, scanId),
              eq(collectionCards.orgId, orgId),
            ),
          )
          .returning({ capturedImagePath: collectionCards.capturedImagePath });
        orphanedCaptures.push(...removed.map((r) => r.capturedImagePath));
      }
      return { success: true, data: null };
    });
    await deleteCaptures(orphanedCaptures);
    if (result.success) emitToSession(guid, "cards_removed", { scanIds });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// POST /collections/:guid/cards/mark-downloaded — mark multiple cards as downloaded
router.post(
  "/:guid/cards/mark-downloaded",
  requireAuth,
  requireOrg,
  async (c) => {
    const orgId = c.get("orgId");
    const guid = c.req.param("guid");
    const parsed = await parseBody(c, ScanIdsSchema);
    if (!parsed.ok) return parsed.response;
    const { scanIds } = parsed.data;
    try {
      const result = await authQuery(c.get("jwtClaims"), async (tx) => {
        for (const scanId of scanIds) {
          await tx
            .update(collectionCards)
            .set({ isDownloaded: true })
            .where(
              and(
                eq(collectionCards.guid, scanId),
                eq(collectionCards.orgId, orgId),
              ),
            );
        }
        return { success: true, data: null };
      });
      if (result.success) emitToSession(guid, "cards_downloaded", { scanIds });
      return c.json(result);
    } catch (err) {
      console.error(err);
      return c.json({ success: false, message: "Database error." }, 500);
    }
  },
);

// DELETE /collections/:guid/cards/:scanId — remove one card
router.delete("/:guid/cards/:scanId", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const { guid, scanId } = c.req.param();
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      const removed = await tx
        .delete(collectionCards)
        .where(
          and(
            eq(collectionCards.guid, scanId),
            eq(collectionCards.orgId, orgId),
          ),
        )
        .returning({ capturedImagePath: collectionCards.capturedImagePath });
      await deleteCaptures(removed.map((r) => r.capturedImagePath));
      return { success: true, data: null };
    });
    if (result.success) emitToSession(guid, "card_removed", { scanId });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// DELETE /collections/:guid/scan-lock — release scanner lock
router.delete("/:guid/scan-lock", requireAuth, requireOrg, async (c) => {
  const guid = c.req.param("guid");
  const userId = c.get("userId");
  releaseLock(guid, userId); // emits lock_released to org subscribers internally
  return c.json({ success: true, data: null });
});

// POST /collections/:guid/debug/error — emit a test scan_error to session watchers (admin only)
router.post("/:guid/debug/error", requireAuth, requireOrg, async (c) => {
  const guid = c.req.param("guid");
  emitToSession(guid, "scan_error", {
    message: "Debug: forced error triggered.",
    timestamp: Date.now(),
  });
  return c.json({ success: true, data: null });
});

// GET /collections/:guid/stream — SSE
router.get("/:guid/stream", async (c) => {
  const guid = c.req.param("guid");
  const orgId = LOCAL_ORG_ID;
  const jwtClaims = LOCAL_JWT_CLAIMS;

  const viewerDisplayName = await getUserDisplayName(LOCAL_USER_ID);

  // Every watcher is the same local user, so identity has to come from the
  // connection rather than the account — otherwise a second device watching
  // the same session is indistinguishable from the first, and the client
  // cannot tell which entry in `viewers` is itself. Echoed back in `init`.
  const viewerId = crypto.randomUUID();

  return streamSSE(c, async (stream) => {
    const writer = (event: string, data: unknown) => {
      stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {});
    };

    // Subscribe first so viewers_updated includes this viewer
    const unsubscribe = subscribeSession(
      guid,
      viewerId,
      viewerDisplayName,
      writer,
    );

    // Send initial state
    try {
      const initial = await authQuery(jwtClaims, async (tx) => {
        const collection = await tx.query.collections.findFirst({
          where: (t, { eq, and }) => and(eq(t.guid, guid), eq(t.orgId, orgId)),
          columns: {
            id: true,
            guid: true,
            name: true,
            isActive: true,
            gameId: true,
            lang: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        if (!collection) return null;

        const game = collection.gameId
          ? await tx.query.games.findFirst({
              where: (t, { eq }) => eq(t.id, collection.gameId!),
            })
          : null;

        const cardRows = await tx
          .select({
            guid: collectionCards.guid,
            card: collectionCards.card,
            scannedAt: collectionCards.scannedAt,
            binNumber: collectionCards.binNumber,
            capturedImagePath: collectionCards.capturedImagePath,
          capturedImageDataUrl: collectionCards.capturedImageDataUrl,
            isFoil: collectionCards.isFoil,
            isDownloaded: collectionCards.isDownloaded,
            alternativeMatches: collectionCards.alternativeMatches,
            variant: collectionCards.variant,
            originalCardId: collectionCards.originalCardId,
            originalDistance: collectionCards.originalDistance,
            originalScore: collectionCards.originalScore,
            wasCorrected: collectionCards.wasCorrected,
          })
          .from(collectionCards)
          .where(eq(collectionCards.collectionId, collection.id))
          .orderBy(desc(collectionCards.scannedAt));

        return {
          collection: {
            guid: collection.guid!,
            name: collection.name,
            isActive: collection.isActive,
            cardCount: cardRows.length,
            lang: collection.lang,
            game: game
              ? {
                  guid: game.guid!,
                  key: game.key,
                  name: game.name,
                  dataSourceUrl: game.dataSourceUrl,
                  isActive: game.isActive,
                  fieldDefinitions: game.fieldDefinitions as FieldMeta[],
                  createdAt: game.createdAt,
                  updatedAt: game.updatedAt,
                }
              : null,
            createdAt: collection.createdAt,
            updatedAt: collection.updatedAt,
          } satisfies Collection,
          cards: cardRows.map(toScannedCard),
          viewers: getSessionViewers(guid),
          viewerId,
        };
      });

      if (initial) {
        await stream.writeSSE({
          event: "session_init",
          data: JSON.stringify(initial),
        });
      }
    } catch {
      // non-fatal — subscriber will still receive live events
    }

    await new Promise<void>((resolve) => {
      stream.onAbort(resolve);
    });

    unsubscribe();
  });
});

export { router as collectionsRouter };
