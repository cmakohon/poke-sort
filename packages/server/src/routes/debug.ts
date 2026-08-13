import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { client, db } from "../db";
import { scanEvents } from "../db/schema";
import { parseTimeParam } from "../lib/time";
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

  const sinceDate = parseTimeParam(since);
  const conditions = [
    tier ? eq(scanEvents.tier, tier) : undefined,
    sinceDate ? gte(scanEvents.createdAt, sinceDate) : undefined,
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

/** Result-size ceiling; the wrapper subquery below enforces it. */
const SQL_ROW_LIMIT = 1000;

/**
 * How long the HTTP response waits. This does NOT cancel the query — PGlite
 * ignores statement_timeout and offers no cancel — and it is best-effort even
 * as a response bound: PGlite executes on the main thread, so a CPU-bound
 * query (verified with pg_sleep) starves the event loop and the timer itself
 * until it finishes. A runaway query blocks the whole process — identify,
 * saves, the machine itself. The only real protection is the row-limit
 * wrapper above and callers keeping debug queries small.
 */
const SQL_RESPONSE_TIMEOUT_MS = 10_000;

router.post("/sql", requireAuth, async (c) => {
  const parsed = await parseBody(c, SqlSchema);
  if (!parsed.ok) return parsed.response;
  // Trailing semicolons would break the wrapper subquery; strip them.
  const sql = parsed.data.sql.replace(/[\s;]+$/, "");

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

  const run = client.transaction(async (tx) => {
    await tx.query("SET TRANSACTION READ ONLY");
    // The wrapper caps an accidental `select * from cards` at a bounded
    // response instead of megabytes of embeddings.
    return tx.query(`select * from (${sql}) as _debug limit ${SQL_ROW_LIMIT}`);
  });

  const timedOut = Symbol("timedOut");
  const outcome = await Promise.race([
    run,
    new Promise<typeof timedOut>((resolve) =>
      setTimeout(() => resolve(timedOut), SQL_RESPONSE_TIMEOUT_MS),
    ),
  ]).catch((err: unknown) => err as Error);

  if (outcome === timedOut) {
    // Swallow the eventual settlement so it cannot become an unhandled
    // rejection after this response has gone out.
    run.catch(() => {});
    return c.json(
      {
        success: false,
        message:
          "Query still running after 10s — PGlite cannot cancel it, and it " +
          "blocks all other database work until it finishes. Keep debug " +
          "queries small, especially while the machine is sorting.",
      },
      408,
    );
  }
  if (outcome instanceof Error) {
    return c.json({ success: false, message: outcome.message }, 400);
  }
  return c.json({
    success: true,
    data: outcome.rows,
    ...(outcome.rows.length === SQL_ROW_LIMIT
      ? { truncatedAt: SQL_ROW_LIMIT }
      : {}),
  });
});

export { router as debugRouter };
