import {
  FIELD_DEFINITIONS,
  getByPath,
  getCardFaceName,
  getCardImageUris,
  type FieldMeta,
  type PlayingCard,
} from "@magic-vault/shared";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { orgSettings } from "../db/schema";

type DiscordEmbed = {
  title: string;
  description: string;
  color: number;
  timestamp: string;
  url?: string;
  image?: { url: string };
};

const CARD_SCANNED_COLOR = 0x5865f2; // Discord blurple

function resolveImageUrl(url: string): string {
  const proxied = url.match(/\/cards\/image-proxy\?url=([^&]+)/);
  if (proxied) {
    try {
      return decodeURIComponent(proxied[1]);
    } catch {
      // malformed encoding - fall through to the raw url below
    }
  }
  if (/^https?:\/\//i.test(url)) return url;
  const base = process.env.WEB_URL ?? "http://localhost:5173";
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

function findPrice(
  card: PlayingCard,
  fieldDefinitions: FieldMeta[],
): string | null {
  if (card.prices?.usd) return card.prices.usd;

  const priceField = fieldDefinitions.find(
    (f) => f.type === "numeric" && /price/i.test(`${f.field} ${f.label}`),
  );
  if (!priceField) return null;

  const raw = getByPath(card, priceField.path);
  const num =
    typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
  return Number.isFinite(num) ? num.toFixed(2) : null;
}

export interface CardScannedEmbedOptions {
  isFoil?: boolean;
  fieldDefinitions?: FieldMeta[];
  collectionName?: string;
  gameName?: string;
  collectionGuid?: string;
}

export function buildCardScannedEmbed(
  card: PlayingCard,
  options: CardScannedEmbedOptions = {},
): DiscordEmbed {
  const {
    isFoil,
    fieldDefinitions = FIELD_DEFINITIONS,
    collectionName,
    gameName,
    collectionGuid,
  } = options;

  const price = findPrice(card, fieldDefinitions);
  const lines = [`**Price:** ${price ? `$${price}` : "N/A"}`];
  if (isFoil) lines.push("**Foil**");
  if (collectionName) lines.push(`**Collection:** ${collectionName}`);
  if (gameName) lines.push(`**Game:** ${gameName}`);

  const imageUrl = getCardImageUris(card)?.normal;
  const monitorUrl = collectionGuid
    ? `${process.env.WEB_URL ?? "http://localhost:5173"}/app/monitor/${collectionGuid}`
    : undefined;

  return {
    title: getCardFaceName(card),
    description: lines.join("\n"),
    color: CARD_SCANNED_COLOR,
    timestamp: new Date().toISOString(),
    ...(monitorUrl ? { url: monitorUrl } : {}),
    ...(imageUrl ? { image: { url: resolveImageUrl(imageUrl) } } : {}),
  };
}

async function getWebhookUrl(orgId: string): Promise<string | null> {
  const rows = await db
    .select({ discordWebhookUrl: orgSettings.discordWebhookUrl })
    .from(orgSettings)
    .where(eq(orgSettings.orgId, orgId))
    .limit(1);
  return rows[0]?.discordWebhookUrl ?? null;
}

export async function sendDiscordNotification(
  orgId: string,
  embed: DiscordEmbed,
): Promise<void> {
  const webhookUrl = await getWebhookUrl(orgId);
  if (!webhookUrl) return;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      console.error(`[discord] Webhook POST failed: ${res.status}`);
    }
  } catch (err) {
    console.error("[discord] Failed to send notification:", err);
  }
}
