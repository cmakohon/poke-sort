export interface PlayingCardImage {
  small: string;
  normal: string;
}

/**
 * The printings TCGdex actually prices.
 *
 * These three are the only keys that appear upstream — there is no
 * `firstEdition` key, so a 1st Edition card is priced as whichever printing it
 * physically is. Note the hyphen: `reverse-holofoil`, not `reverseHolofoil`.
 */
export type TcgPlayerPrintingKey = "normal" | "holofoil" | "reverse-holofoil";

export interface TcgPlayerPrintingPrice {
  /** Identifies the card on TCGplayer, not the printing — often shared. */
  productId?: number;
  lowPrice?: number | null;
  midPrice?: number | null;
  highPrice?: number | null;
  marketPrice?: number | null;
  directLowPrice?: number | null;
}

/**
 * Flat, unlike the TCGplayer side: the only printing split is a `-holo`
 * suffix, and those fields are null on plenty of cards.
 */
export interface CardMarketPricing {
  updated?: string;
  unit?: string;
  idProduct?: number;
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
  avg1?: number | null;
  avg7?: number | null;
  avg30?: number | null;
  "avg-holo"?: number | null;
  "low-holo"?: number | null;
  "trend-holo"?: number | null;
  "avg1-holo"?: number | null;
  "avg7-holo"?: number | null;
  "avg30-holo"?: number | null;
}

/**
 * Upstream pricing, by printing.
 *
 * There is no condition breakdown anywhere in this data — no near-mint,
 * lightly-played or graded tiers exist upstream, so nothing here can be
 * conditioned on wear.
 */
export interface CardPricing {
  cardmarket?: CardMarketPricing;
  tcgplayer?: { unit?: string; updated?: string } & Partial<
    Record<TcgPlayerPrintingKey, TcgPlayerPrintingPrice>
  >;
}

export interface PlayingCard {
  id: string;
  name: string;
  image: PlayingCardImage | null;
  set: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  typeLine: string;
  text?: string;
  /** Printed HP, as a string so an absent value stays distinguishable from 0. */
  hp?: string;
  /** Pokemon energy types, e.g. ["Lightning"]. */
  types: string[];
  artist?: string;
  /**
   * One number, for the bin rules — they route on `price_usd` at the instant a
   * card is identified, so it has to be a scalar. Which printing it came from
   * is decided by resolvePrintingKey (see ../pricing).
   */
  price: number | null;
  /**
   * The full upstream pricing, for display. Absent on cards saved before this
   * field existed and on cards upstream prices at all — read it through
   * `getCardPricing`, which falls back to `raw.pricing`.
   */
  pricing?: CardPricing;
  /**
   * Which printing this physical copy is, when detection could tell:
   * "firstEdition" | "normal". Absent when the card has no variant printings
   * or nothing examined the capture.
   */
  variant?: string;
  sourceUrl?: string;
  /** Retreat cost, in energy. */
  retreatCost?: number;
  raw?: unknown;
}

export interface PlayingCardWithDistance extends PlayingCard {
  distance: number;
}
