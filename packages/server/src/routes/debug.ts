import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { client, db } from "../db";
import { scanEvents } from "../db/schema";
import { parseBody } from "../lib/validate";
import { requireAuth, type AppEnv } from "../middleware/auth";

/**
 * Diagnostics surface, not product surface — hence the /api/debug/ prefix.
 *
 * The primary consumer is an assistant (or a human with curl) asking questions
 * like "show me the review-tier scans from today" or "what happened in the 30
 * seconds before the last disconnect". The typed scan-events listing covers
 * the common questions cheaply; the SQL endpoint covers the ones nobody
 * anticipated. The app binds loopback and holds no secrets, so a read-only
 * query endpoint is an acceptable trade for a personal machine.
 */

const router = new Hono<AppEnv>();

router.get("/scan-events", requireAuth, async (c) => {
  const tier = c.req.query("tier");
  const since = c.req.query("since");
  const corrected = c.req.query("corrected") === "1";
  const full = c.req.query("full") === "1";
  const limit = Math.min(Number(c.req.query("limit")) || 100, 1000);

  const sinceDate = since ? new Date(since) : null;
  const conditions = [
    tier ? eq(scanEvents.tier, tier) : undefined,
    sinceDate && !Number.isNaN(sinceDate.getTime())
      ? gte(scanEvents.createdAt, sinceDate)
      : undefined,
    corrected ? isNotNull(scanEvents.correctedCardId) : undefined,
  ].filter((f) => f !== undefined);

  const rows = await db
    .select()
    .from(scanEvents)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(scanEvents.createdAt))
    .limit(limit);

  // The jsonb blobs (candidates especially) dominate the response size; a
  // listing pass usually only wants the scalars.
  const data = full
    ? rows
    : rows.map(({ ocr: _o, candidates: _c, stamp: _s, ...rest }) => rest);

  return c.json({ success: true, data });
});

const SqlSchema = z.object({ sql: z.string().min(1).max(20_000) }).strict();

router.post("/sql", requireAuth, async (c) => {
  const parsed = await parseBody(c, SqlSchema);
  if (!parsed.ok) return parsed.response;
  const sql = parsed.data.sql;

  // Belt: only statements that read. Suspenders: the transaction is READ ONLY,
  // so even a `WITH ... INSERT` that slips past the regex fails at the engine.
  // client.transaction also rejects multi-statement strings, closing the
  // "select 1; drop table" shape.
  if (!/^\s*(select|with)\b/i.test(sql)) {
    return c.json(
      { success: false, message: "Only SELECT/WITH statements are allowed." },
      400,
    );
  }

  try {
    const result = await client.transaction(async (tx) => {
      await tx.query("SET TRANSACTION READ ONLY");
      return tx.query(sql);
    });
    return c.json({ success: true, data: result.rows });
  } catch (err) {
    return c.json(
      {
        success: false,
        message: err instanceof Error ? err.message : "Query failed.",
      },
      400,
    );
  }
});

export { router as debugRouter };
