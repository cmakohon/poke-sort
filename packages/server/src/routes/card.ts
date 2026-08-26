import { Hono } from "hono";
import {
  DEFAULT_CATALOG_LANG,
  searchLocalCatalog,
} from "../lib/card-search/local";
import {
  resolveAdapterForGame,
  resolveCardSearch,
  resolveGameKeyAndLang,
} from "../lib/card-search/resolve";
import { saveCaptureBuffer } from "../lib/captures";
import { sendDiscordNotification } from "../lib/discord";
import { identifyCard } from "../lib/identify";
import {
  clearScanEventCapture,
  recordScanEvent,
  scanEventCaptureName,
} from "../lib/scan-events";
import { requireAuth, requireOrg, type AppEnv } from "../middleware/auth";

const router = new Hono<AppEnv>();

router.post("/", requireAuth, requireOrg, async (c) => {
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

  const imageBuffer = Buffer.from(await file.arrayBuffer());

  const resolved = await resolveGameKeyAndLang(
    c.get("jwtClaims"),
    collectionGuid,
  );
  if (!resolved) {
    return c.json(
      { success: false, message: "No game configured for this collection." },
      400,
    );
  }

  try {
    const t0 = Date.now();
    const result = await identifyCard(
      imageBuffer,
      resolved.gameKey,
      resolved.lang,
    );
    const durationMs = Date.now() - t0;

    // Diagnostics row + capture for every attempt, no-match included — a scan
    // that produced nothing sortable is still evidence. The row insert is
    // awaited (milliseconds, and the guid must be real before the client can
    // echo it back); the image write is not on the scan's critical path. A
    // diagnostics failure must never fail the scan itself.
    const scanEventId = crypto.randomUUID();
    const capturePath = scanEventCaptureName(scanEventId);
    try {
      await recordScanEvent({
        guid: scanEventId,
        orgId: c.get("orgId"),
        collectionGuid,
        gameKey: resolved.gameKey,
        lang: resolved.lang,
        result,
        durationMs,
        capturePath,
      });
      void saveCaptureBuffer(capturePath, imageBuffer).catch(async (err) => {
        console.error("[scan-events] capture write failed:", err);
        await clearScanEventCapture(scanEventId).catch(() => {});
      });
      result.scanEventId = scanEventId;
    } catch (err) {
      console.error("[scan-events] record failed:", err);
    }

    return c.json({
      success: true,
      message: "Successfully searched for card.",
      data: result,
    });
  } catch (err) {
    console.error(err);
    const orgId = c.req.header("X-Org-Id");
    if (orgId) {
      void sendDiscordNotification(orgId, {
        title: "PokeSort — Card Search Error",
        description: "A database error occurred while searching for a card.",
        color: 0xed4245,
        timestamp: new Date().toISOString(),
      });
    }
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// /search must be registered before /search/:id to avoid path conflicts.
// Dispatches to whichever game's card API backs the given collection -
// see lib/card-search/resolve.ts. Every game is
// registered explicitly there; there is no implicit default game.
//
// ?gameKey= is the fallback for callers with no collection to name: the
// review screen searches against scan_events rows, which record the game
// but may have been captured with no collection active.
async function resolveSearchContext(c: {
  get(key: "jwtClaims"): string;
  req: { query(name: string): string | undefined };
}) {
  const resolved = await resolveCardSearch(
    c.get("jwtClaims"),
    c.req.query("collectionGuid"),
  );
  if (resolved) return resolved;
  const gameKey = c.req.query("gameKey");
  return gameKey ? resolveAdapterForGame(gameKey) : null;
}

/**
 * The game and language whose catalog rows to search.
 *
 * Same collection-then-?gameKey= resolution as the adapter lookup above, but
 * search reads the local `cards` table rather than a game's remote API, so it
 * needs the language too. A caller naming only a game gets the catalog's
 * default language — the review screen searches against scan_events rows,
 * which record the game but not the collection's language.
 */
async function resolveSearchCatalog(c: {
  get(key: "jwtClaims"): string;
  req: { query(name: string): string | undefined };
}) {
  const resolved = await resolveGameKeyAndLang(
    c.get("jwtClaims"),
    c.req.query("collectionGuid"),
  );
  if (resolved) return resolved;
  const gameKey = c.req.query("gameKey");
  return gameKey ? { gameKey, lang: DEFAULT_CATALOG_LANG } : null;
}

router.get("/search", requireAuth, async (c) => {
  const resolved = await resolveSearchCatalog(c);
  if (!resolved) {
    return c.json(
      { success: false, message: "No game configured for this collection." },
      400,
    );
  }
  const page = await searchLocalCatalog({
    ...resolved,
    query: c.req.query("q") ?? "",
    setCode: c.req.query("setCode") || undefined,
    page: Number(c.req.query("page") ?? 1),
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
  });
  return c.json({ success: true, message: "Cards retrieved.", data: page });
});

/**
 * The explicit fallback when the local catalog comes back empty: search the
 * game's live API instead. Registered before /search/:id so "online" is not
 * read as a card id.
 *
 * Not a replacement for /search — it costs one upstream detail fetch per hit,
 * so it is wired to a button the reviewer presses, never to typing.
 */
router.get("/search/online", requireAuth, async (c) => {
  const resolved = await resolveSearchContext(c);
  if (!resolved) {
    return c.json(
      { success: false, message: "No game configured for this collection." },
      400,
    );
  }
  if (!resolved.adapter.searchByName) {
    return c.json(
      { success: false, message: "This game has no online card search." },
      404,
    );
  }
  const result = await resolved.adapter.searchByName(
    c.req.query("q") ?? "",
    resolved.baseUrl,
  );
  return c.json(result);
});

router.get("/search/:id", requireAuth, async (c) => {
  const resolved = await resolveSearchContext(c);
  if (!resolved) {
    return c.json(
      { success: false, message: "No game configured for this collection." },
      400,
    );
  }
  const result = await resolved.adapter.searchById(
    c.req.param("id"),
    resolved.baseUrl,
  );
  return c.json(result);
});

const ALLOWED_IMAGE_HOSTS = new Set(["assets.tcgdex.net"]);

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
    headers: { "User-Agent": "PokeSort/1.0", Accept: "image/*" },
  });
  const contentType = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !contentType.startsWith("image/")) {
    return c.json({ success: false, message: "Failed to fetch image." }, 502);
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  return c.body(buffer, 200, {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=86400",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
});

export { router as cardRouter };
