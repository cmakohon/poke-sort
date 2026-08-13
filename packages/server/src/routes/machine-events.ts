import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { machineEvents } from "../db/schema";
import { parseTimeParam } from "../lib/time";
import { parseBody } from "../lib/validate";
import { requireAuth, type AppEnv } from "../middleware/auth";

/**
 * Machine/serial telemetry ingest and readback.
 *
 * The renderer is the only process that can see the serial port, but it is
 * also the process whose console evaporates on restart — so it batches events
 * here and the answers to "what happened around the last disconnect" become a
 * query instead of an ask-the-user-to-paste-the-console exercise. Ingest is
 * deliberately dumb: no classification, no Discord — that stays with
 * /api/notifications/serial-event.
 */

const EventSchema = z.object({
  sessionId: z.string().min(1).max(64),
  connectionId: z.string().max(64).optional(),
  seq: z.number().int().nonnegative(),
  ts: z.number().finite(),
  eventType: z.string().min(1).max(40),
  command: z.string().max(40).optional(),
  outcome: z.enum(["ok", "timeout", "write_failed", "reset"]).optional(),
  latencyMs: z.number().int().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const BatchSchema = z
  .object({ events: z.array(EventSchema).min(1).max(500) })
  .strict();

const router = new Hono<AppEnv>();

router.post("/", requireAuth, async (c) => {
  const parsed = await parseBody(c, BatchSchema);
  if (!parsed.ok) return parsed.response;

  await db.insert(machineEvents).values(
    parsed.data.events.map((e) => ({
      sessionId: e.sessionId,
      connectionId: e.connectionId ?? null,
      seq: e.seq,
      ts: new Date(e.ts),
      eventType: e.eventType,
      command: e.command ?? null,
      outcome: e.outcome ?? null,
      latencyMs: e.latencyMs ?? null,
      payload: e.payload ?? null,
    })),
  );
  return c.json({ success: true });
});

router.get("/", requireAuth, async (c) => {
  const since = parseTimeParam(c.req.query("since"));
  const until = parseTimeParam(c.req.query("until"));
  const type = c.req.query("type");
  const session = c.req.query("session");
  const limit = Math.min(Number(c.req.query("limit")) || 200, 2000);

  const conditions = [
    since ? gte(machineEvents.ts, since) : undefined,
    until ? lte(machineEvents.ts, until) : undefined,
    type ? eq(machineEvents.eventType, type) : undefined,
    session ? eq(machineEvents.sessionId, session) : undefined,
  ].filter((f) => f !== undefined);

  const rows = await db
    .select()
    .from(machineEvents)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(machineEvents.ts), desc(machineEvents.seq))
    .limit(limit);

  return c.json({ success: true, data: rows });
});

export { router as machineEventsRouter };
