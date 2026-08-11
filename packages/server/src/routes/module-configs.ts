import { Hono } from "hono";
import { z } from "zod";
import { parseBody } from "../lib/validate";
import { authQuery } from "../db";
import { moduleConfigAudit, moduleConfigs } from "../db/schema";
import { DEFAULT_CALIBRATION, type ModuleConfig, type ServoCalibration } from "@poke-sort/shared";
import { requireAuth, requireOrg, type AppEnv } from "../middleware/auth";

const router = new Hono<AppEnv>();

/**
 * The seven servo positions, and nothing else.
 *
 * `.strict()` is the point: the body used to be spread straight into the
 * insert, so it could set columns it has no business setting — including
 * `moduleNumber`, which `...calibration` spread over, letting a request point
 * the write at a different servo module than the URL named. Rejecting unknown
 * keys keeps the URL parameter authoritative.
 *
 * Servo angles, so bounded to degrees rather than merely "a number".
 */
const servoAngle = z.number().int().min(0).max(180);

const CalibrationSchema = z
  .object({
    bottomClosed: servoAngle,
    bottomOpen: servoAngle,
    paddleClosed: servoAngle,
    paddleOpen: servoAngle,
    pusherLeft: servoAngle,
    pusherNeutral: servoAngle,
    pusherRight: servoAngle,
  })
  .strict() satisfies z.ZodType<ServoCalibration>;

/** Three physical diverter modules; anything else is not addressable. */
function parseModuleNumber(raw: string | undefined): 1 | 2 | 3 | null {
  const n = Number.parseInt(raw ?? "", 10);
  return n === 1 || n === 2 || n === 3 ? n : null;
}

function toModuleConfig(row: {
  moduleNumber: number;
  bottomClosed: number;
  bottomOpen: number;
  paddleClosed: number;
  paddleOpen: number;
  pusherLeft: number;
  pusherNeutral: number;
  pusherRight: number;
}): ModuleConfig {
  return {
    moduleNumber: row.moduleNumber as 1 | 2 | 3,
    calibration: {
      bottomClosed: row.bottomClosed,
      bottomOpen: row.bottomOpen,
      paddleClosed: row.paddleClosed,
      paddleOpen: row.paddleOpen,
      pusherLeft: row.pusherLeft,
      pusherNeutral: row.pusherNeutral,
      pusherRight: row.pusherRight,
    },
  };
}

type CalibRow = { moduleNumber: number; bottomClosed: number; bottomOpen: number; paddleClosed: number; paddleOpen: number; pusherLeft: number; pusherNeutral: number; pusherRight: number };
function buildConfigs(rows: CalibRow[]): ModuleConfig[] {
  return ([1, 2, 3] as const).map((n) => {
    const row = rows.find((r) => r.moduleNumber === n);
    return row ? toModuleConfig(row) : { moduleNumber: n, calibration: { ...DEFAULT_CALIBRATION } };
  });
}

// GET /modules
router.get("/", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      const rows = await tx.query.moduleConfigs.findMany({
        where: (t, { eq }) => eq(t.orgId, orgId),
      });
      return { success: true, message: "Loaded module configs.", data: buildConfigs(rows) };
    });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// PUT /modules/:moduleNumber
router.put("/:moduleNumber", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const moduleNumber = parseModuleNumber(c.req.param("moduleNumber"));
  if (moduleNumber === null) {
    return c.json({ success: false, message: "Module number must be 1, 2 or 3." }, 400);
  }
  const body = await parseBody(c, CalibrationSchema);
  if (!body.ok) return body.response;
  const calibration = body.data;
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      await tx
        .insert(moduleConfigs)
        .values({ moduleNumber, ...calibration, orgId })
        .onConflictDoUpdate({
          target: [moduleConfigs.orgId, moduleConfigs.moduleNumber],
          set: { ...calibration, updatedAt: new Date() },
        });

      await tx.insert(moduleConfigAudit).values({ moduleNumber, ...calibration, orgId });

      const rows = await tx.query.moduleConfigs.findMany({
        where: (t, { eq }) => eq(t.orgId, orgId),
      });
      return { success: true, message: "Saved module config.", data: buildConfigs(rows) };
    });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// GET /modules/history
router.get("/history", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      const rows = await tx.query.moduleConfigAudit.findMany({
        where: (t, { eq }) => eq(t.orgId, orgId),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
        limit: 30,
      });
      return {
        success: true,
        message: "Loaded history.",
        data: rows.map((r) => ({
          guid: r.guid!,
          moduleNumber: r.moduleNumber as 1 | 2 | 3,
          calibration: {
            bottomClosed: r.bottomClosed,
            bottomOpen: r.bottomOpen,
            paddleClosed: r.paddleClosed,
            paddleOpen: r.paddleOpen,
            pusherLeft: r.pusherLeft,
            pusherNeutral: r.pusherNeutral,
            pusherRight: r.pusherRight,
          } satisfies ServoCalibration,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// POST /modules/history/:guid/revert
router.post("/history/:guid/revert", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const guid = c.req.param("guid");
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      const entry = await tx.query.moduleConfigAudit.findFirst({
        where: (t, { eq, and }) => and(eq(t.guid, guid), eq(t.orgId, orgId)),
      });
      if (!entry) return { success: false, message: "Audit record not found." };

      const calibration: ServoCalibration = {
        bottomClosed: entry.bottomClosed,
        bottomOpen: entry.bottomOpen,
        paddleClosed: entry.paddleClosed,
        paddleOpen: entry.paddleOpen,
        pusherLeft: entry.pusherLeft,
        pusherNeutral: entry.pusherNeutral,
        pusherRight: entry.pusherRight,
      };

      await tx
        .insert(moduleConfigs)
        .values({ moduleNumber: entry.moduleNumber, ...calibration, orgId })
        .onConflictDoUpdate({
          target: [moduleConfigs.orgId, moduleConfigs.moduleNumber],
          set: { ...calibration, updatedAt: new Date() },
        });

      await tx.insert(moduleConfigAudit).values({ moduleNumber: entry.moduleNumber, ...calibration, orgId });

      const rows = await tx.query.moduleConfigs.findMany({
        where: (t, { eq }) => eq(t.orgId, orgId),
      });
      return { success: true, message: "Reverted module config.", data: buildConfigs(rows) };
    });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

export { router as moduleConfigsRouter };
