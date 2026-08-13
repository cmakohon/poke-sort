import type { PlayingCard } from "@poke-sort/shared";

/**
 * Formats a collector number the way it's printed on the card: "025/191".
 *
 * The set total lives only on the raw TCGdex payload (`set.cardCount.official`),
 * so cards from other sources — or scans made before set enrichment — fall back
 * to the bare "#58" form. Only purely numeric numbers get the "/total" form:
 * subset numbers like "TG12" or "SVP 049" are printed over their own subset's
 * total (TG12/TG30), which we don't have — showing "TG12/195" would fabricate
 * a number that exists on no card.
 */
export function formatCardNumber(card: PlayingCard): string {
  const number = card.collectorNumber;
  if (!number) return "";
  if (!/^\d+$/.test(number)) return `#${number}`;

  const raw = card.raw as
    | { set?: { cardCount?: { official?: number } } }
    | undefined;
  const total = raw?.set?.cardCount?.official;
  if (!total || total <= 0) return `#${number}`;

  return `${number.padStart(String(total).length, "0")}/${total}`;
}
