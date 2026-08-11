export interface PlayingCardImage {
  small: string;
  normal: string;
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
  price: number | null;
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
