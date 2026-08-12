import type { PlayingCard } from "@poke-sort/shared";

/**
 * Formats a collector number the way it's printed on the card: "025/191".
 *
 * The set total lives only on the raw TCGdex payload (`set.cardCount.official`),
 * so cards from other sources — or scans made before set enrichment — fall back
 * to the bare "#58" form. Numeric numbers are zero-padded to the total's width,
 * matching the modern printed style; non-numeric numbers (promos like "SVP 049",
 * "TG12") are shown as-is over the total.
 */
export function formatCardNumber(card: PlayingCard): string {
  const number = card.collectorNumber;
  if (!number) return "";

  const raw = card.raw as
    | { set?: { cardCount?: { official?: number } } }
    | undefined;
  const total = raw?.set?.cardCount?.official;
  if (!total || total <= 0) return `#${number}`;

  const padded = /^\d+$/.test(number)
    ? number.padStart(String(total).length, "0")
    : number;
  return `${padded}/${total}`;
}
