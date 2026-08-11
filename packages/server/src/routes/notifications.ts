import type {
  NotificationSettings,
  SerialEventReport,
} from "@poke-sort/shared";
import { Hono } from "hono";
import { z } from "zod";
import { parseBody } from "../lib/validate";
import { authQuery } from "../db";
import { notificationSettings } from "../db/schema";
import { sendDiscordNotification } from "../lib/discord";
import { classifySerialEvent } from "../lib/serial-events";
import { requireAuth, requireOrg, type AppEnv } from "../middleware/auth";

const router = new Hono<AppEnv>();

// GET /notifications
router.get("/", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      const row = await tx.query.notificationSettings.findFirst({
        where: (t, { eq }) => eq(t.orgId, orgId),
      });
      const settings: NotificationSettings = {
        discordWebhookUrl: row?.discordWebhookUrl ?? null,
      };
      return {
        success: true,
        message: "Loaded notification settings.",
        data: settings,
      };
    });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

/** Mirrors SerialEventReport; `response` is opaque device output, so unknown. */
export const SerialEventSchema = z
  .object({
    command: z.enum(["connect", "test", "feeder", "auto-feed", "bin", "jam"]),
    sent: z.boolean(),
    response: z.unknown(),
    cardName: z.string().optional(),
    binNumber: z.number().int().optional(),
  })
  .strict();

/**
 * The webhook is fetched by the server, so it is checked before it is stored
 * rather than at send time — an unparseable value would otherwise sit in the
 * database and fail silently on every notification.
 */
export const NotificationSettingsSchema = z
  .object({
    discordWebhookUrl: z.union([z.string().url(), z.literal(""), z.null()]),
  })
  .strict();

// PUT /notifications
router.put("/", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const parsed = await parseBody(c, NotificationSettingsSchema);
  if (!parsed.ok) return parsed.response;
  const body: NotificationSettings = {
    discordWebhookUrl: parsed.data.discordWebhookUrl || null,
  };
  try {
    const result = await authQuery(c.get("jwtClaims"), async (tx) => {
      await tx
        .insert(notificationSettings)
        .values({ discordWebhookUrl: body.discordWebhookUrl, orgId })
        .onConflictDoUpdate({
          target: [notificationSettings.orgId],
          set: {
            discordWebhookUrl: body.discordWebhookUrl,
            updatedAt: new Date(),
          },
        });
      const row = await tx.query.notificationSettings.findFirst({
        where: (t, { eq }) => eq(t.orgId, orgId),
      });
      const saved: NotificationSettings = {
        discordWebhookUrl: row?.discordWebhookUrl ?? null,
      };
      return {
        success: true,
        message: "Saved notification settings.",
        data: saved,
      };
    });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

const TEST_EMBEDS: Record<string, { title: string; description: string }> = {
  "sorter-error": {
    title: "PokeSort — Sorter Error [TEST]",
    description:
      "**Card:** Lightning Bolt\n**Bin:** 3\n**Error:** No response from the device in time.",
  },
  "feeder-empty": {
    title: "PokeSort — Feeder Empty [TEST]",
    description:
      "No cards remaining in the hopper. Add more cards to continue.",
  },
  "card-jam": {
    title: "PokeSort — Card Jam Detected [TEST]",
    description:
      "Card stuck at module 2 (heading to bin 5). Check the sorter and resume.",
  },
  "card-search-error": {
    title: "PokeSort — Card Search Error [TEST]",
    description: "A database error occurred while searching for a card.",
  },
  "sync-failure": {
    title: "PokeSort — Sync Failed [TEST]",
    description:
      "The card database sync job encountered a fatal error.\n\n**Error:** TCGdex catalog fetch failed: 503",
  },
};

// POST /notifications/test
router.post("/test", requireAuth, requireOrg, async (c) => {
  const parsedTest = await parseBody(c, z.object({ type: z.string() }).strict());
  if (!parsedTest.ok) return parsedTest.response;
  const { type } = parsedTest.data;
  const embed = TEST_EMBEDS[type];
  if (!embed) {
    return c.json(
      { success: false, message: "Unknown notification type." },
      400,
    );
  }
  const orgId = c.get("orgId");
  await sendDiscordNotification(orgId, {
    ...embed,
    color: 0xed4245,
    timestamp: new Date().toISOString(),
  });
  return c.json({ success: true, message: "Test notification sent." });
});

// POST /notifications/serial-event — raw serial command/response pair reported
router.post("/serial-event", requireAuth, requireOrg, async (c) => {
  const parsedEvent = await parseBody(c, SerialEventSchema);
  if (!parsedEvent.ok) return parsedEvent.response;
  const event = parsedEvent.data as SerialEventReport;
  const classified = classifySerialEvent(event);
  if (classified) {
    const orgId = c.get("orgId");
    void sendDiscordNotification(orgId, {
      title: `PokeSort — ${classified.title}`,
      description: classified.description,
      color: 0xed4245,
      timestamp: new Date().toISOString(),
    });
  }
  return c.json({ success: true, message: "Serial event reported." });
});

export { router as notificationsRouter };
