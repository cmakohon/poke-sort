import { count, eq, ilike } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { parseBody } from "../lib/validate";

/** Optional filter for the destructive catalog clear; absent means every game. */
export const ClearSchema = z.object({ gameKey: z.string().trim().min(1).optional() }).strict();
import { streamSSE } from "hono/streaming";
import { db } from "../db";
import { cardImageVectors } from "../db/schema";
import { resolveGameDataSourceUrl } from "../lib/card-search/resolve";
import {
  cancelSync,
  getStatus,
  startSync,
  subscribeSSE,
  SYNC_SOURCES,
} from "../lib/sync-job";
import { getPackJobState, packUrlFor, startPackImport } from "../lib/pack/fetch-job";
import { countCards } from "../lib/pack/import";
import { vectorizeImageFromBuffer } from "../lib/vectorize";
import { requireAuth, requireRole, type AppEnv } from "../middleware/auth";

const router = new Hono<AppEnv>();

// POST /admin/catalog/import — download a prebuilt pack and import it.
// Embedding the catalog locally is a multi-hour CPU job; this is the path a
// normal install is expected to take. `url` is optional and may be a local
// path, so a maintainer can verify a pack before publishing it.
router.post("/catalog/import", requireAuth, requireRole("admin"), async (c) => {
  const parsed = await parseBody(
    c,
    z
      .object({
        gameKey: z.string().trim().min(1),
        lang: z.string().trim().min(1).optional(),
        // Where the pack is downloaded from, so it is constrained to http(s)
        // rather than accepting file:// or anything else fetch would honour.
        url: z
          .string()
          .url()
          .refine((u) => /^https?:$/.test(new URL(u).protocol), {
            message: "must be an http(s) URL",
          })
          .optional(),
      })
      .strict(),
  );
  if (!parsed.ok) return parsed.response;
  const { gameKey, lang, url } = parsed.data;

  const { started, message } = startPackImport(gameKey, lang ?? "en", url);
  return c.json({ success: started, message, data: getPackJobState() }, started ? 200 : 409);
});

// GET /admin/catalog/import — progress of the running/last import.
router.get("/catalog/import", requireAuth, requireRole("admin"), (c) =>
  c.json({ success: true, data: getPackJobState() }),
);

// GET /admin/catalog/:gameKey — is this game's catalog populated?
// Drives the first-run prompt: an empty catalog means nothing can be scanned.
router.get("/catalog/:gameKey", requireAuth, requireRole("admin"), async (c) => {
  const gameKey = c.req.param("gameKey");
  const lang = c.req.query("lang") ?? "en";
  return c.json({
    success: true,
    data: {
      gameKey,
      lang,
      count: await countCards(gameKey, lang),
      packUrl: packUrlFor(gameKey, lang),
    },
  });
});

// GET /admin/sync/stream — SSE (must be before GET /admin/sync)
router.get("/sync/stream", async (c) => {
  return streamSSE(c, async (stream) => {
    const unsubscribe = subscribeSSE((event, data) => {
      stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {});
    });

    await new Promise<void>((resolve) => {
      stream.onAbort(resolve);
    });

    unsubscribe();
  });
});

// GET /admin/sync
router.get("/sync", requireAuth, requireRole("admin"), (c) => {
  return c.json({ success: true, data: getStatus() });
});

// GET /admin/sync/sources — which games can be synced
router.get("/sync/sources", requireAuth, requireRole("admin"), (c) => {
  const sources = Object.values(SYNC_SOURCES).map((s) => ({
    gameKey: s.gameKey,
    label: s.label,
    languages: s.languages,
  }));
  return c.json({ success: true, data: sources });
});

// POST /admin/sync
router.post("/sync", requireAuth, requireRole("admin"), async (c) => {
  const parsed = await parseBody(
    c,
    z
      .object({
        gameKey: z.string().trim().min(1),
        lang: z.string().trim().min(1).optional(),
      })
      .strict(),
  );
  if (!parsed.ok) return parsed.response;
  const { gameKey } = parsed.data;
  const lang = parsed.data.lang ?? "en";
  const source = SYNC_SOURCES[gameKey];
  if (!source) {
    return c.json(
      { success: false, message: `Unknown sync source: ${gameKey}` },
      400,
    );
  }
  if (!source.languages.includes(lang)) {
    return c.json(
      {
        success: false,
        message: `${source.label} does not support language: ${lang}`,
      },
      400,
    );
  }

  startSync(c.req.header("X-Org-Id"), gameKey, lang);
  return c.json({ success: true, data: getStatus() });
});

// DELETE /admin/sync
router.delete("/sync", requireAuth, requireRole("admin"), (c) => {
  cancelSync();
  return c.json({ success: true, data: getStatus() });
});

// GET /admin/cards — paginated card list with optional search
router.get("/cards", requireAuth, requireRole("admin"), async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const search = (c.req.query("search") ?? "").trim();
  const offset = (page - 1) * limit;
  const where = search
    ? ilike(cardImageVectors.name, `%${search}%`)
    : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: cardImageVectors.id,
        cardId: cardImageVectors.cardId,
        gameKey: cardImageVectors.gameKey,
        lang: cardImageVectors.lang,
        name: cardImageVectors.name,
        setCode: cardImageVectors.setCode,
        updatedAt: cardImageVectors.updatedAt,
      })
      .from(cardImageVectors)
      .where(where)
      .orderBy(cardImageVectors.name)
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(cardImageVectors).where(where),
  ]);

  return c.json({ success: true, data: { cards: rows, total, page, limit } });
});

// Fetches a single card by id from its source, vectorizes its image, and
// upserts it into the card database — used to both add a missing card and
// to re-vectorize an existing one.
async function syncOneCard(
  gameKey: string,
  cardId: string,
  lang: string,
): Promise<
  | { success: true; message: string }
  | { success: false; message: string; status: 400 | 404 | 502 }
> {
  const source = SYNC_SOURCES[gameKey];
  if (!source) {
    return {
      success: false,
      message: `Unknown sync source: ${gameKey}`,
      status: 400,
    };
  }
  const baseUrl = await resolveGameDataSourceUrl(gameKey, source.defaultUrl);

  const card = await source.fetchOne(cardId, baseUrl);
  if (!card) {
    return {
      success: false,
      message: `Card not found via ${source.label}`,
      status: 404,
    };
  }
  if (!card.imageUrl) {
    return {
      success: false,
      message: "No image available for this card",
      status: 400,
    };
  }

  const imageRes = await fetch(card.imageUrl, { headers: source.fetchHeaders });
  if (!imageRes.ok) {
    return {
      success: false,
      message: "Failed to download card image",
      status: 502,
    };
  }
  const buffer = Buffer.from(await imageRes.arrayBuffer());
  const embedding = await vectorizeImageFromBuffer(buffer);

  await db
    .insert(cardImageVectors)
    .values({
      cardId,
      gameKey,
      lang,
      name: card.name,
      setCode: card.setCode,
      embedding,
      collectorNumber: card.collectorNumber ?? null,
      setTotal: card.setTotal ?? null,
      cardData: card.data ?? null,
    })
    .onConflictDoUpdate({
      target: cardImageVectors.cardId,
      set: {
        gameKey,
        lang,
        name: card.name,
        setCode: card.setCode,
        embedding,
        collectorNumber: card.collectorNumber ?? null,
        setTotal: card.setTotal ?? null,
        cardData: card.data ?? null,
        updatedAt: new Date(),
      },
    });

  return { success: true, message: `Synced: ${card.name}` };
}

// POST /admin/cards/sync — fetch + vectorize a single card by id, adding it
// to the database if it isn't already there
router.post("/cards/sync", requireAuth, requireRole("admin"), async (c) => {
  const parsed = await parseBody(
    c,
    z
      .object({
        gameKey: z.string().trim().min(1),
        cardId: z.string().trim().min(1),
        lang: z.string().trim().min(1).optional(),
      })
      .strict(),
  );
  if (!parsed.ok) return parsed.response;
  const { gameKey, cardId } = parsed.data;
  const lang = parsed.data.lang ?? "en";

  const result = await syncOneCard(gameKey, cardId, lang);
  if (!result.success) {
    return c.json({ success: false, message: result.message }, result.status);
  }
  return c.json({ success: true, message: result.message });
});

// POST /admin/cards/:cardId/revectorize — re-fetch image and regenerate embedding
router.post(
  "/cards/:cardId/revectorize",
  requireAuth,
  requireRole("admin"),
  async (c) => {
    const cardId = c.req.param("cardId");

    const existing = await db.query.cardImageVectors.findFirst({
      where: (t, { eq }) => eq(t.cardId, cardId),
      columns: { gameKey: true, lang: true },
    });
    if (!existing) {
      return c.json(
        {
          success: false,
          message: `Card ${cardId} not found in database.`,
        },
        404,
      );
    }

    const result = await syncOneCard(existing.gameKey, cardId, existing.lang);
    if (!result.success) {
      return c.json({ success: false, message: result.message }, result.status);
    }
    return c.json({
      success: true,
      message: result.message.replace("Synced:", "Re-vectorized:"),
    });
  },
);

// GET /admin/cards/games — distinct game keys currently in the card database, with counts
router.get("/cards/games", requireAuth, requireRole("admin"), async (c) => {
  const rows = await db
    .select({ gameKey: cardImageVectors.gameKey, count: count() })
    .from(cardImageVectors)
    .groupBy(cardImageVectors.gameKey)
    .orderBy(cardImageVectors.gameKey);

  return c.json({ success: true, data: rows });
});

// POST /admin/cards/dump — delete card vectors, either all of them or just one game's
router.post("/cards/dump", requireAuth, requireRole("admin"), async (c) => {
  if (getStatus().status === "running") {
    return c.json(
      { success: false, message: "Cannot dump while sync is running" },
      409,
    );
  }

  let gameKey: string | undefined;
  try {
    const body = ClearSchema.parse(await c.req.json());
    if (body.gameKey) gameKey = body.gameKey;
  } catch {
    // An absent or unparseable body means "clear everything", which is this
    // route's documented default — so it stays tolerant rather than 400ing.
  }

  if (gameKey) {
    await db
      .delete(cardImageVectors)
      .where(eq(cardImageVectors.gameKey, gameKey));
    return c.json({ success: true, message: `Cleared "${gameKey}" cards` });
  }

  await db.delete(cardImageVectors);
  return c.json({ success: true, message: "Card database cleared" });
});

export { router as adminRouter };
