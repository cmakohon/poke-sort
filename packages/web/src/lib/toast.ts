/**
 * How long toasts stay up.
 *
 * Hardware faults — a jam, an empty feeder, a sorter error — used to be
 * `duration: Infinity` so a stopped machine could not be missed. That also
 * made them impossible to get rid of: sonner had no close button, so a stale
 * fault sat in the corner for the rest of the session. They are long-lived
 * rather than permanent now, and every toast carries an X (see
 * components/ui/sonner.tsx).
 */
export const TOAST_DURATION_MS = 5_000;

/** Machine faults: long enough to survive walking back to the machine. */
export const FAULT_TOAST_DURATION_MS = 30_000;
