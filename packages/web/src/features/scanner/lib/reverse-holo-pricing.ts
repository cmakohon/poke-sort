import {
  getCardPricing,
  resolveMarketPrice,
  type PlayingCardWithDistance,
} from "@poke-sort/shared";

/**
 * Re-prices a card as its reverse-holofoil printing.
 *
 * Mirrors the server's re-price on the foil toggle
 * (routes/collections.ts): that printing is routinely worth several times the
 * normal one, and both the bin the sorter physically drops the card into and
 * the collection total are computed from `price`. It has to run on the client
 * because bin evaluation happens here, before the server ever sees the scan.
 */
export function repriceAsReverseHolo(
  card: PlayingCardWithDistance,
): PlayingCardWithDistance {
  const market = resolveMarketPrice(getCardPricing(card), "reverse");
  // Leave the price alone when the printing has no price of its own — better
  // a stale number than a confidently wrong one.
  return market != null ? { ...card, price: market } : card;
}
