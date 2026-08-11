import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { parseBody } from "../lib/validate";
import { db } from "../db";
import { cardImageVectors, games } from "../db/schema";
import { getGameFacets } from "../lib/facets";
import { requireAuth, requireRole, type AppEnv } from "../middleware/auth";
import type { FieldMeta, Game } from "@poke-sort/shared";

const router = new Hono<AppEnv>();

function toGame(row: typeof games.$inferSelect): Game {
  return {
    guid: row.guid!,
    key: row.key,
    name: row.name,
    dataSourceUrl: row.dataSourceUrl,
    isActive: row.isActive,
    fieldDefinitions: row.fieldDefinitions as FieldMeta[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * `fieldDefinitions` drives the bin rule engine, so a malformed one does not
 * fail loudly — it produces rules that silently never match and cards that
 * quietly land in the catch-all bin. Each entry is checked for the parts
 * evaluate-bin actually reads.
 *
 * `dataSourceUrl` is fetched by the server, so it is restricted to http(s)
 * rather than accepting any string that happens to parse as a URL.
 */
const FieldMetaSchema = z
  .object({
    field: z.string().min(1),
    label: z.string().min(1),
    type: z.string().min(1),
    path: z.string().min(1),
    operators: z.array(z.object({ value: z.string(), label: z.string() })),
    options: z
      .array(z.object({ value: z.string(), label: z.string() }))
      .optional(),
    facetKey: z.string().optional(),
    optionsSource: z.string().optional(),
  })
  .passthrough();

const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:$/.test(new URL(u).protocol), {
    message: "must be an http(s) URL",
  });

export const GameInputSchema = z
  .object({
    key: z.string().trim().min(1),
    name: z.string().trim().min(1),
    dataSourceUrl: httpUrl,
    fieldDefinitions: z.array(FieldMetaSchema),
    isActive: z.boolean().optional(),
  })
  .strict();

type GameInput = z.infer<typeof GameInputSchema>;

// GET /games — any authenticated user (needed to pick a game per collection)
router.get("/", requireAuth, async (c) => {
  try {
    const rows = await db.select().from(games).orderBy(games.name);
    return c.json({ success: true, data: rows.map(toGame) });
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// GET /games/:key/facets — which values actually exist in the local catalog.
// Registered before /:guid routes so "facets" is never read as a guid.
router.get("/:key/facets", requireAuth, async (c) => {
  const key = c.req.param("key");
  const lang = c.req.query("lang") ?? "en";
  try {
    return c.json({ success: true, data: await getGameFacets(key, lang) });
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// GET /games/:guid/languages — distinct languages present in the card database for this game
router.get("/:guid/languages", requireAuth, async (c) => {
  const guid = c.req.param("guid");
  try {
    const game = await db.query.games.findFirst({
      where: (t, { eq }) => eq(t.guid, guid),
      columns: { key: true },
    });
    if (!game) return c.json({ success: false, message: "Game not found." }, 404);

    const rows = await db
      .select({ lang: cardImageVectors.lang })
      .from(cardImageVectors)
      .where(eq(cardImageVectors.gameKey, game.key))
      .groupBy(cardImageVectors.lang)
      .orderBy(cardImageVectors.lang);

    return c.json({ success: true, data: rows.map((r) => r.lang) });
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// POST /games
router.post("/", requireAuth, requireRole("admin"), async (c) => {
  const parsed = await parseBody(c, GameInputSchema);
  if (!parsed.ok) return parsed.response;
  const { key, name, dataSourceUrl, fieldDefinitions, isActive } = parsed.data;

  try {
    const [row] = await db
      .insert(games)
      .values({
        key: key.trim(),
        name: name.trim(),
        dataSourceUrl: dataSourceUrl.trim(),
        fieldDefinitions,
        isActive: isActive ?? true,
      })
      .returning();
    return c.json({ success: true, data: toGame(row) });
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      return c.json(
        { success: false, message: `A game with key "${key}" already exists.` },
        409,
      );
    }
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// PUT /games/:guid
router.put("/:guid", requireAuth, requireRole("admin"), async (c) => {
  const guid = c.req.param("guid");
  const parsed = await parseBody(c, GameInputSchema.partial());
  if (!parsed.ok) return parsed.response;
  const { key, name, dataSourceUrl, fieldDefinitions, isActive } = parsed.data;

  try {
    const target = await db.query.games.findFirst({
      where: (t, { eq }) => eq(t.guid, guid),
      columns: { id: true },
    });
    if (!target) return c.json({ success: false, message: "Game not found." }, 404);

    const updates: Partial<typeof games.$inferInsert> = { updatedAt: new Date() };
    if (key !== undefined) updates.key = key.trim();
    if (name !== undefined) updates.name = name.trim();
    if (dataSourceUrl !== undefined) updates.dataSourceUrl = dataSourceUrl.trim();
    if (fieldDefinitions !== undefined) updates.fieldDefinitions = fieldDefinitions;
    if (isActive !== undefined) updates.isActive = isActive;

    const [row] = await db
      .update(games)
      .set(updates)
      .where(eq(games.id, target.id))
      .returning();
    return c.json({ success: true, data: toGame(row) });
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      return c.json(
        { success: false, message: `A game with key "${key}" already exists.` },
        409,
      );
    }
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// DELETE /games/:guid
router.delete("/:guid", requireAuth, requireRole("admin"), async (c) => {
  const guid = c.req.param("guid");
  try {
    const target = await db.query.games.findFirst({
      where: (t, { eq }) => eq(t.guid, guid),
      columns: { id: true },
    });
    if (!target) return c.json({ success: false, message: "Game not found." }, 404);

    await db.delete(games).where(eq(games.id, target.id));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

export { router as gamesRouter };
