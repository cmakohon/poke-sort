import type {
  CardPricing,
  TcgPlayerPrintingKey,
  TcgPlayerPrintingPrice,
} from "./interfaces/card.interface";

/**
 * Which printing a card's price comes from.
 *
 * This lives in shared rather than beside the adapter because two callers need
 * to agree on it: the server picks the scalar `price` that bin rules route on,
 * and the detail panel labels which printing that number came from. Split
 * across packages they would drift, and the panel would start naming the wrong
 * row — confidently, and with no way to notice.
 */

/**
 * Fallback order when the printing is unknown, which is almost always.
 *
 * `normal` first is deliberate: it is what the previous implementation
 * effectively resolved to for every card, so keeping it first means no card's
 * price — and therefore no card's bin — moves.
 */
export const TCGPLAYER_PRINTING_ORDER: TcgPlayerPrintingKey[] = [
  "normal",
  "holofoil",
  "reverse-holofoil",
];

/**
 * App variant -> the upstream printings that could be it.
 *
 * There is no `firstEdition` key upstream, so a stamped card is priced as
 * whichever printing it physically is — holo for the Base-era cards the stamp
 * detector actually fires on, normal otherwise.
 */
export const VARIANT_PRINTING_KEYS: Record<string, TcgPlayerPrintingKey[]> = {
  normal: ["normal"],
  reverse: ["reverse-holofoil"],
  holo: ["holofoil"],
  firstEdition: ["holofoil", "normal"],
  wPromo: ["holofoil", "normal"],
};

/**
 * Structured pricing off a card, wherever it lives.
 *
 * The typed field wins over `raw` so a live refresh during identify beats the
 * pack-time snapshot; the `raw` fallback is what keeps cards saved before the
 * field existed rendering.
 */
export function getCardPricing(card: {
  pricing?: CardPricing;
  raw?: unknown;
}): CardPricing | undefined {
  if (card.pricing) return card.pricing;
  const raw = card.raw;
  if (!raw || typeof raw !== "object") return undefined;
  const pricing = (raw as { pricing?: unknown }).pricing;
  return pricing && typeof pricing === "object"
    ? (pricing as CardPricing)
    : undefined;
}

/** The printings that carry any data at all, in display order. */
export function listPrintings(
  pricing: CardPricing | undefined,
): Array<{ key: TcgPlayerPrintingKey; price: TcgPlayerPrintingPrice }> {
  const tcg = pricing?.tcgplayer;
  if (!tcg) return [];
  const out: Array<{ key: TcgPlayerPrintingKey; price: TcgPlayerPrintingPrice }> = [];
  for (const key of TCGPLAYER_PRINTING_ORDER) {
    const price = tcg[key];
    if (price) out.push({ key, price });
  }
  return out;
}

/**
 * Which printing to headline.
 *
 * `detected` is true only when the app knew the variant AND that variant's
 * printing has a market price — so the UI can say "this card" rather than just
 * naming a row. A printing with a null market price is still returned (with
 * `detected: false`) so its low/high range can be shown.
 */
export function resolvePrintingKey(
  pricing: CardPricing | undefined,
  variant?: string,
): { key: TcgPlayerPrintingKey; detected: boolean } | null {
  const tcg = pricing?.tcgplayer;
  if (!tcg) return null;

  const preferred = (variant && VARIANT_PRINTING_KEYS[variant]) || [];
  for (const key of preferred) {
    if (tcg[key]?.marketPrice != null) return { key, detected: true };
  }
  for (const key of TCGPLAYER_PRINTING_ORDER) {
    if (tcg[key]?.marketPrice != null) return { key, detected: false };
  }
  // Nothing priced, but a printing may still carry a range worth showing.
  const present = listPrintings(pricing)[0];
  return present ? { key: present.key, detected: false } : null;
}

/**
 * TCGdex ships no product URL, only an id. This path resolves without a slug.
 * Null rather than a guessed search URL — a link that lands on the wrong card
 * is worse than no link.
 */
export function tcgplayerProductUrl(productId?: number): string | null {
  return productId != null
    ? `https://www.tcgplayer.com/product/${productId}`
    : null;
}
