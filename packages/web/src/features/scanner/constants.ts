import type { ScannerStatus } from "@magic-vault/shared";

export const SCANNABLE_STATUSES: ScannerStatus[] = [
  "scanning",
  "no-match",
  "duplicate",
];

export const RARITY_LABELS: Record<string, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  mythic: "Mythic",
  special: "Special",
  bonus: "Bonus",
};

export const RARITY_ORDER = [
  "mythic",
  "rare",
  "uncommon",
  "common",
  "special",
  "bonus",
];

// 63 x 88 mm — the standard TCG card size, shared by Magic and Pokemon, so one
// constant genuinely covers both. (It was named MTG_ASPECT_RATIO, which implied
// a Magic-specific value leaking into other games; the value is correct, the
// name was not.)
export const CARD_ASPECT_RATIO = 2.5 / 3.5;

// After the module 1 IR sensor confirms a card has arrived, how long to wait
// before capturing a frame - the card is still sliding into place when the
// sensor first trips, so scanning immediately can catch it mid-motion/blurred.
export const CARD_SETTLE_DELAY_MS = 500;
