import type { ScannerStatus } from "@poke-sort/shared";

export const SCANNABLE_STATUSES: ScannerStatus[] = [
  "scanning",
  "no-match",
  "duplicate",
];

// 63 x 88 mm — the standard TCG card size.
export const CARD_ASPECT_RATIO = 2.5 / 3.5;

// After the module 1 IR sensor confirms a card has arrived, how long to wait
// before capturing a frame - the card is still sliding into place when the
// sensor first trips, so scanning immediately can catch it mid-motion/blurred.
export const CARD_SETTLE_DELAY_MS = 500;
