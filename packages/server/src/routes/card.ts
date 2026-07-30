import type { SearchCardMatch } from "@magic-vault/shared";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { authQuery } from "../db";
import { resolveCardSearch, resolveGameKey } from "../lib/card-search/resolve";
import { sendDiscordNotification } from "../lib/discord";
import { vectorizeImageFromBuffer } from "../lib/vectorize";
import { requireAuth, type AppEnv } from "../middleware/auth";

const router = new Hono<AppEnv>();

router.post("/", requireAuth, async (c) => {
  const body = await c.req.parseBody();
  const file = body["image"];
  const collectionGuid =
    typeof body["collectionGuid"] === "string"
      ? body["collectionGuid"]
      : undefined;

  if (!file || typeof file === "string") {
    return c.json({ success: false, message: "No image provided." }, 400);
  }

  if (!file.type.startsWith("image/")) {
    return c.json(
      { success: false, message: "Uploaded file is not an image." },
      400,
    );
  }

  let embedding: number[];
  try {
    embedding = await vectorizeImageFromBuffer(
      Buffer.from(await file.arrayBuffer()),
    );
  } catch (err) {
    console.error(err);
    return c.json(
      { success: false, message: "Failed to vectorize image." },
      500,
    );
  }

  const embeddingStr = `[${embedding.join(",")}]`;
  const gameKey = await resolveGameKey(c.get("jwtClaims"), collectionGuid);

  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      const matches = await tx.execute(sql`
        SELECT
          scryfall_id,
          embedding <=> ${embeddingStr}::vector(768) AS distance
        FROM cards
        WHERE game_key = ${gameKey} AND (embedding <=> ${embeddingStr}::vector(768)) < 0.3
        ORDER BY embedding <=> ${embeddingStr}::vector(768)
        LIMIT 5
      `);

      const matchList: SearchCardMatch[] = matches.rows.map((row) => ({
        id: row.scryfall_id as string,
        scryfallId: row.scryfall_id as string,
        distance: row.distance as number,
      }));

      return {
        message: "Successfully searched for card.",
        success: true,
        data: matchList.length > 0 ? matchList : null,
      };
    });

    return c.json(result);
  } catch (err) {
    console.error(err);
    const orgId = c.req.header("X-Org-Id");
    if (orgId) {
      void sendDiscordNotification(orgId, {
        title: "Magic Vault — Card Search Error",
        description: "A database error occurred while searching for a card.",
        color: 0xed4245,
        timestamp: new Date().toISOString(),
      });
    }
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// /search must be registered before /search/:id to avoid path conflicts.
// Dispatches to whichever game's card API backs the given collection
// (Scryfall by default) - see lib/card-search/resolve.ts.
router.get("/search", requireAuth, async (c) => {
  const query = c.req.query("q") ?? "";
  const { adapter, baseUrl } = await resolveCardSearch(
    c.get("jwtClaims"),
    c.req.query("collectionGuid"),
  );
  const result = await adapter.search(query, baseUrl);
  return c.json(result);
});

router.get("/search/:id", requireAuth, async (c) => {
  const { adapter, baseUrl } = await resolveCardSearch(
    c.get("jwtClaims"),
    c.req.query("collectionGuid"),
  );
  const result = await adapter.searchById(c.req.param("id"), baseUrl);
  return c.json(result);
});

const ALLOWED_IMAGE_HOSTS = new Set([
  "cards.scryfall.io",
  "gundam-gcg.com",
  "www.gundam-gcg.com",
]);

router.get("/image-proxy", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ success: false, message: "Missing url." }, 400);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return c.json({ success: false, message: "Invalid url." }, 400);
  }
  if (
    parsed.protocol !== "https:" ||
    !ALLOWED_IMAGE_HOSTS.has(parsed.hostname)
  ) {
    return c.json({ success: false, message: "Host not allowed." }, 400);
  }

  const upstream = await fetch(parsed.toString(), {
    headers: { "User-Agent": "MagicVault/1.0", Accept: "image/*" },
  });
  const contentType = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !contentType.startsWith("image/")) {
    return c.json({ success: false, message: "Failed to fetch image." }, 502);
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  return c.body(buffer, 200, {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=86400",
    // Without this, Chrome's Opaque Response Blocking silently drops the
    // image when it's embedded from a different origin than the API.
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
});

export { router as cardRouter };
