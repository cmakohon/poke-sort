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

/** A wrong-verdict in progress: the truth is chosen, the reason is not. */
export interface PendingVerdict {
  kind: "corrected" | "unresolvable";
  /** Truth card; set only for corrected. */
  cardId?: string;
  cardName?: string;
  reason?: MismatchReason;
}

export interface ReviewMachineState {
  phase: ReviewPhase;
  pending: PendingVerdict | null;
}

export const INITIAL_REVIEW_STATE: ReviewMachineState = {
  phase: "focus",
  pending: null,
};

export type ReviewMachineEvent =
  | { type: "CONFIRM_CORRECT" }
  | { type: "PICK_CANDIDATE"; cardId: string; cardName?: string }
  | { type: "OPEN_SEARCH" }
  | { type: "SEARCH_SELECT"; cardId: string; cardName?: string }
  | { type: "MARK_UNRESOLVABLE" }
  | { type: "SELECT_REASON"; reason: MismatchReason }
  | { type: "SUBMIT" }
  | { type: "CANCEL" };

export interface ReviewMachineContext {
  /** False for scans with no candidates — there is nothing to confirm. */
  hasPrediction: boolean;
}

export interface SaveCommand {
  verdict: ReviewVerdict;
  correctedCardId?: string;
  mismatchReason?: MismatchReason;
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
              },
            },
          };
        case "OPEN_SEARCH":
          return { state: { phase: "search", pending: null } };
        case "MARK_UNRESOLVABLE":
          return {
            state: { phase: "reason", pending: { kind: "unresolvable" } },
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
        case "SELECT_REASON":
          return {
            state: { phase: "reason", pending: { ...pending, reason: event.reason } },
          };
        case "SUBMIT":
          if (pending.kind === "corrected") {
            // The server requires both; refuse to commit half a correction.
            if (!pending.cardId || !pending.reason) return { state };
            return {
              state: INITIAL_REVIEW_STATE,
              save: {
                verdict: "corrected",
                correctedCardId: pending.cardId,
                mismatchReason: pending.reason,
              },
            };
          }
          return {
            state: INITIAL_REVIEW_STATE,
            save: {
              verdict: "unresolvable",
              mismatchReason: pending.reason,
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
