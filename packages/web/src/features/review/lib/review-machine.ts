import type { MismatchReason, ReviewVerdict } from "@poke-sort/shared";

/**
 * The review screen's keyboard flow as a pure reducer, kept out of React so
 * the whole transition table is unit-testable.
 *
 * Phases: `focus` (verdict keys live) → `reason` (truth chosen, mismatch
 * reason pending) or `search` (catalog picker owns the keyboard) → back to
 * `focus`. Persisting a verdict is expressed as a `save` command returned
 * from the transition; the component executes it and advances the queue.
 */

export type ReviewPhase = "focus" | "reason" | "search";

/**
 * A verdict in progress, waiting on reasons. "variant" means the identity
 * was right but the printing was wrong (stamp/edition/foil) — it saves as
 * verdict "correct" carrying reasons, because identity-level eval must not
 * count it as a miss and the true variant often has no catalog entry to
 * correct to.
 */
export interface PendingVerdict {
  kind: "corrected" | "unresolvable" | "variant";
  /** Truth card; set only for corrected. */
  cardId?: string;
  cardName?: string;
  /** Multi-select: input problems and match problems can co-occur. */
  reasons: MismatchReason[];
}

export interface ReviewMachineState {
  phase: ReviewPhase;
  pending: PendingVerdict | null;
}

export const INITIAL_REVIEW_STATE: ReviewMachineState = {
  phase: "focus",
  pending: null,
};

/**
 * Which reasons the panel offers for what is being recorded.
 *
 * MISMATCH_REASONS is the validation set, not a menu: showing all of it made
 * the operator read past reasons that cannot apply ("wrong card entirely" on a
 * scan nobody could identify), and once it grew past ten it stopped fitting
 * the digits. Every list here is at most nine long, so the panel is always
 * keyed 1-9 with no wrap-around.
 */
export const REASONS_BY_KIND: Record<
  PendingVerdict["kind"],
  readonly MismatchReason[]
> = {
  corrected: [
    "wrong-card",
    "same-pokemon-different-card",
    "same-art-different-set",
    "same-card-wrong-type",
    "ocr-misread",
    "image-quality",
    "upside-down",
    "other",
  ],
  // What "I looked and still cannot say" breaks down into. The catalog gap
  // leads, because it is the one with a fix on our side.
  unresolvable: [
    "card-not-in-catalog",
    "not-a-card",
    "image-quality",
    "upside-down",
    "other",
  ],
  // The identity is right and the printing is not. A league stamp or a
  // promo edition frequently has no catalog row of its own, which is why
  // card-not-in-catalog belongs here too.
  variant: ["wrong-variant", "card-not-in-catalog", "other"],
};

export type ReviewMachineEvent =
  | { type: "CONFIRM_CORRECT" }
  | { type: "PICK_CANDIDATE"; cardId: string; cardName?: string }
  | { type: "OPEN_SEARCH" }
  | { type: "SEARCH_SELECT"; cardId: string; cardName?: string }
  | { type: "MARK_UNRESOLVABLE" }
  | { type: "MARK_WRONG_VARIANT" }
  | { type: "MARK_CARD_NOT_LISTED" }
  | { type: "TOGGLE_REASON"; reason: MismatchReason }
  | { type: "SUBMIT" }
  | { type: "CANCEL" };

export interface ReviewMachineContext {
  /** False for scans with no candidates — there is nothing to confirm. */
  hasPrediction: boolean;
}

export interface SaveCommand {
  verdict: ReviewVerdict;
  correctedCardId?: string;
  mismatchReasons?: MismatchReason[];
}

export interface TransitionResult {
  state: ReviewMachineState;
  /** Present when this transition commits a verdict. */
  save?: SaveCommand;
}

export function transition(
  state: ReviewMachineState,
  event: ReviewMachineEvent,
  ctx: ReviewMachineContext,
): TransitionResult {
  switch (state.phase) {
    case "focus":
      switch (event.type) {
        case "CONFIRM_CORRECT":
          if (!ctx.hasPrediction) return { state };
          return { state, save: { verdict: "correct" } };
        case "PICK_CANDIDATE":
          return {
            state: {
              phase: "reason",
              pending: {
                kind: "corrected",
                cardId: event.cardId,
                cardName: event.cardName,
                reasons: [],
              },
            },
          };
        case "OPEN_SEARCH":
          return { state: { phase: "search", pending: null } };
        case "MARK_UNRESOLVABLE":
          return {
            state: {
              phase: "reason",
              pending: { kind: "unresolvable", reasons: [] },
            },
          };
        case "MARK_CARD_NOT_LISTED":
          // The printing is real and the catalog has no row for it, so there
          // is nothing to correct to — it saves as unresolvable carrying the
          // reason. One key away from the focus screen because it is the
          // single most common thing a reviewer cannot otherwise record.
          return {
            state: {
              phase: "reason",
              pending: {
                kind: "unresolvable",
                reasons: ["card-not-in-catalog"],
              },
            },
          };
        case "MARK_WRONG_VARIANT":
          // Only meaningful against a prediction whose identity is right.
          if (!ctx.hasPrediction) return { state };
          return {
            state: {
              phase: "reason",
              pending: { kind: "variant", reasons: ["wrong-variant"] },
            },
          };
        default:
          return { state };
      }

    case "search":
      switch (event.type) {
        case "SEARCH_SELECT":
          return {
            state: {
              phase: "reason",
              pending: {
                kind: "corrected",
                cardId: event.cardId,
                cardName: event.cardName,
                reasons: [],
              },
            },
          };
        case "CANCEL":
          return { state: INITIAL_REVIEW_STATE };
        default:
          return { state };
      }

    case "reason": {
      const pending = state.pending;
      if (!pending) return { state: INITIAL_REVIEW_STATE };
      switch (event.type) {
        case "TOGGLE_REASON": {
          const reasons = pending.reasons.includes(event.reason)
            ? pending.reasons.filter((r) => r !== event.reason)
            : [...pending.reasons, event.reason];
          return {
            state: { phase: "reason", pending: { ...pending, reasons } },
          };
        }
        case "SUBMIT":
          if (pending.kind === "corrected") {
            // The server requires both; refuse to commit half a correction.
            if (!pending.cardId || pending.reasons.length === 0) {
              return { state };
            }
            return {
              state: INITIAL_REVIEW_STATE,
              save: {
                verdict: "corrected",
                correctedCardId: pending.cardId,
                mismatchReasons: pending.reasons,
              },
            };
          }
          if (pending.kind === "variant") {
            // Identity confirmed; the reasons describe the printing problem.
            if (pending.reasons.length === 0) return { state };
            return {
              state: INITIAL_REVIEW_STATE,
              save: { verdict: "correct", mismatchReasons: pending.reasons },
            };
          }
          return {
            state: INITIAL_REVIEW_STATE,
            save: {
              verdict: "unresolvable",
              mismatchReasons:
                pending.reasons.length > 0 ? pending.reasons : undefined,
            },
          };
        case "CANCEL":
          return { state: INITIAL_REVIEW_STATE };
        default:
          return { state };
      }
    }
  }
}
