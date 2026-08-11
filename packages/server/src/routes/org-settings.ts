import { eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  SCAN_COVERAGE_MAX,
  SCAN_COVERAGE_MIN,
  SCAN_OFFSET_LIMIT,
} from "@poke-sort/shared";
import { z } from "zod";
import { parseBody } from "../lib/validate";
import { authQuery } from "../db";
import { orgSettings } from "../db/schema";
import { requireAuth, requireOrg, type AppEnv } from "../middleware/auth";

const router = new Hono<AppEnv>();

const DEFAULT_SCAN_REGION = { coverage: 0.85, offsetX: 0, offsetY: 0 };

function toScanRegion(row?: {
  scanCoverage: number | null;
  scanOffsetX: number | null;
  scanOffsetY: number | null;
}) {
  return {
    coverage:
      row?.scanCoverage != null
        ? row.scanCoverage / 100
        : DEFAULT_SCAN_REGION.coverage,
    offsetX:
      row?.scanOffsetX != null
        ? row.scanOffsetX / 100
        : DEFAULT_SCAN_REGION.offsetX,
    offsetY:
      row?.scanOffsetY != null
        ? row.scanOffsetY / 100
        : DEFAULT_SCAN_REGION.offsetY,
  };
}

router.get("/", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      const row = await tx.query.orgSettings.findFirst({
        where: eq(orgSettings.orgId, orgId),
      });
      return {
        success: true,
        message: "Loaded.",
        data: {
          primaryColor: row?.primaryColor ?? null,
          scannerLayout:
            (row?.scannerLayout as "horizontal" | "vertical") ?? "horizontal",
          discordWebhookUrl: row?.discordWebhookUrl ?? null,
          discordNotifyOnScan: row?.discordNotifyOnScan ?? false,
          scanRegion: toScanRegion(row),
        },
      };
    });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

/**
 * A partial update: the handler distinguishes "key absent" (keep the stored
 * value) from "key present and null" (clear it), so every field is optional and
 * nullable rather than defaulted. zod strips nothing that was sent and adds
 * nothing that was not, which is what keeps the `in` checks below meaningful.
 *
 * The scan region is expressed as fractions of the frame. Coverage is 0.1..1,
 * but the offsets are SIGNED — they shift the capture window from the centre,
 * so a camera mounted high and left needs negatives. Bounds mirror the UI's
 * clampRegion so the API cannot reject a region the calibration screen can
 * produce.
 */
const coverage = z.number().min(SCAN_COVERAGE_MIN).max(SCAN_COVERAGE_MAX);
/** Signed: the capture window moves either way from the centre of the frame. */
const offset = z.number().min(-SCAN_OFFSET_LIMIT).max(SCAN_OFFSET_LIMIT);

const OrgSettingsSchema = z
  .object({
    primaryColor: z.string().max(64).nullable().optional(),
    scannerLayout: z.string().max(64).nullable().optional(),
    discordWebhookUrl: z
      .union([z.string().url(), z.literal("")])
      .nullable()
      .optional(),
    discordNotifyOnScan: z.boolean().optional(),
    scanRegion: z
      .object({
        coverage,
        offsetX: offset,
        offsetY: offset,
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

router.put("/", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const parsed = await parseBody(c, OrgSettingsSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      const existing = await tx.query.orgSettings.findFirst({
        where: eq(orgSettings.orgId, orgId),
      });
      const merged = {
        primaryColor:
          "primaryColor" in body
            ? (body.primaryColor ?? null)
            : (existing?.primaryColor ?? null),
        scannerLayout:
          "scannerLayout" in body
            ? (body.scannerLayout ?? null)
            : (existing?.scannerLayout ?? null),
        discordWebhookUrl:
          "discordWebhookUrl" in body
            ? (body.discordWebhookUrl ?? null)
            : (existing?.discordWebhookUrl ?? null),
        discordNotifyOnScan:
          "discordNotifyOnScan" in body
            ? (body.discordNotifyOnScan ?? false)
            : (existing?.discordNotifyOnScan ?? false),
        scanCoverage:
          "scanRegion" in body
            ? body.scanRegion
              ? Math.round(body.scanRegion.coverage * 100)
              : null
            : (existing?.scanCoverage ?? null),
        scanOffsetX:
          "scanRegion" in body
            ? body.scanRegion
              ? Math.round(body.scanRegion.offsetX * 100)
              : null
            : (existing?.scanOffsetX ?? null),
        scanOffsetY:
          "scanRegion" in body
            ? body.scanRegion
              ? Math.round(body.scanRegion.offsetY * 100)
              : null
            : (existing?.scanOffsetY ?? null),
      };
      await tx
        .insert(orgSettings)
        .values({ orgId, ...merged })
        .onConflictDoUpdate({
          target: [orgSettings.orgId],
          set: { ...merged, updatedAt: new Date() },
        });
      return {
        success: true,
        message: "Saved.",
        data: {
          primaryColor: merged.primaryColor,
          scannerLayout:
            (merged.scannerLayout as "horizontal" | "vertical") ?? "horizontal",
          discordWebhookUrl: merged.discordWebhookUrl,
          discordNotifyOnScan: merged.discordNotifyOnScan,
          scanRegion: toScanRegion(merged),
        },
      };
    });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

export { router as orgSettingsRouter };
