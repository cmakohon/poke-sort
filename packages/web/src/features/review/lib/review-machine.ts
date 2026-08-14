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

/** A wrong-verdict in progress: the truth is chosen, the reasons are not. */
export interface PendingVerdict {
  kind: "corrected" | "unresolvable";
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

export type ReviewMachineEvent =
  | { type: "CONFIRM_CORRECT" }
  | { type: "PICK_CANDIDATE"; cardId: string; cardName?: string }
  | { type: "OPEN_SEARCH" }
  | { type: "SEARCH_SELECT"; cardId: string; cardName?: string }
  | { type: "MARK_UNRESOLVABLE" }
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
