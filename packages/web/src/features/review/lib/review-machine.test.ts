import { describe, expect, it } from "vitest";
import {
  INITIAL_REVIEW_STATE,
  transition,
  type ReviewMachineState,
} from "./review-machine";

const HAS_PREDICTION = { hasPrediction: true };
const NO_PREDICTION = { hasPrediction: false };

describe("review machine", () => {
  describe("focus", () => {
    it("confirms correct and stays in focus", () => {
      const r = transition(
        INITIAL_REVIEW_STATE,
        { type: "CONFIRM_CORRECT" },
        HAS_PREDICTION,
      );
      expect(r.save).toEqual({ verdict: "correct" });
      expect(r.state.phase).toBe("focus");
    });

    it("refuses to confirm a scan with no prediction", () => {
      const r = transition(
        INITIAL_REVIEW_STATE,
        { type: "CONFIRM_CORRECT" },
        NO_PREDICTION,
      );
      expect(r.save).toBeUndefined();
      expect(r.state).toEqual(INITIAL_REVIEW_STATE);
    });

    it("picking a candidate moves to reason with the truth pending", () => {
      const r = transition(
        INITIAL_REVIEW_STATE,
        { type: "PICK_CANDIDATE", cardId: "swsh1-1", cardName: "Celebi V" },
        HAS_PREDICTION,
      );
      expect(r.save).toBeUndefined();
      expect(r.state.phase).toBe("reason");
      expect(r.state.pending).toMatchObject({
        kind: "corrected",
        cardId: "swsh1-1",
        reasons: [],
      });
    });

    it("opens search", () => {
      const r = transition(
        INITIAL_REVIEW_STATE,
        { type: "OPEN_SEARCH" },
        HAS_PREDICTION,
      );
      expect(r.state.phase).toBe("search");
    });

    it("marking unresolvable moves to reason without a card", () => {
      const r = transition(
        INITIAL_REVIEW_STATE,
        { type: "MARK_UNRESOLVABLE" },
        NO_PREDICTION,
      );
      expect(r.state.phase).toBe("reason");
      expect(r.state.pending).toEqual({ kind: "unresolvable", reasons: [] });
    });

    it("ignores reason-phase events", () => {
      const r = transition(
        INITIAL_REVIEW_STATE,
        { type: "TOGGLE_REASON", reason: "upside-down" },
        HAS_PREDICTION,
      );
      expect(r.state).toEqual(INITIAL_REVIEW_STATE);
      expect(r.save).toBeUndefined();
    });
  });

  describe("search", () => {
    const searching: ReviewMachineState = { phase: "search", pending: null };

    it("selecting a result moves to reason", () => {
      const r = transition(
        searching,
        { type: "SEARCH_SELECT", cardId: "base1-4", cardName: "Charizard" },
        HAS_PREDICTION,
      );
      expect(r.state.phase).toBe("reason");
      expect(r.state.pending).toMatchObject({
        kind: "corrected",
        cardId: "base1-4",
      });
    });

    it("escape returns to focus", () => {
      const r = transition(searching, { type: "CANCEL" }, HAS_PREDICTION);
      expect(r.state).toEqual(INITIAL_REVIEW_STATE);
    });

    it("ignores focus-phase verdict keys", () => {
      const r = transition(
        searching,
        { type: "CONFIRM_CORRECT" },
        HAS_PREDICTION,
      );
      expect(r.state).toEqual(searching);
      expect(r.save).toBeUndefined();
    });
  });

  describe("reason", () => {
    const corrected: ReviewMachineState = {
      phase: "reason",
      pending: { kind: "corrected", cardId: "base1-4", reasons: [] },
    };
    const unresolvable: ReviewMachineState = {
      phase: "reason",
      pending: { kind: "unresolvable", reasons: [] },
    };

    it("toggles a reason on and stays for the note / submit", () => {
      const r = transition(
        corrected,
        { type: "TOGGLE_REASON", reason: "same-art-different-set" },
        HAS_PREDICTION,
      );
      expect(r.state.phase).toBe("reason");
      expect(r.state.pending?.reasons).toEqual(["same-art-different-set"]);
      expect(r.save).toBeUndefined();
    });

    it("toggles a reason back off", () => {
      const on = transition(
        corrected,
        { type: "TOGGLE_REASON", reason: "upside-down" },
        HAS_PREDICTION,
      ).state;
      const off = transition(
        on,
        { type: "TOGGLE_REASON", reason: "upside-down" },
        HAS_PREDICTION,
      );
      expect(off.state.pending?.reasons).toEqual([]);
    });

    it("accumulates multiple reasons", () => {
      const one = transition(
        corrected,
        { type: "TOGGLE_REASON", reason: "upside-down" },
        HAS_PREDICTION,
      ).state;
      const two = transition(
        one,
        { type: "TOGGLE_REASON", reason: "same-pokemon-different-card" },
        HAS_PREDICTION,
      );
      expect(two.state.pending?.reasons).toEqual([
        "upside-down",
        "same-pokemon-different-card",
      ]);
    });

    it("refuses to submit a correction without a reason", () => {
      const r = transition(corrected, { type: "SUBMIT" }, HAS_PREDICTION);
      expect(r.save).toBeUndefined();
      expect(r.state).toEqual(corrected);
    });

    it("submits a correction once truth and reasons are set", () => {
      const withReason = transition(
        corrected,
        { type: "TOGGLE_REASON", reason: "upside-down" },
        HAS_PREDICTION,
      ).state;
      const r = transition(withReason, { type: "SUBMIT" }, HAS_PREDICTION);
      expect(r.save).toEqual({
        verdict: "corrected",
        correctedCardId: "base1-4",
        mismatchReasons: ["upside-down"],
      });
      expect(r.state).toEqual(INITIAL_REVIEW_STATE);
    });

    it("submits unresolvable without a reason", () => {
      const r = transition(unresolvable, { type: "SUBMIT" }, NO_PREDICTION);
      expect(r.save).toEqual({
        verdict: "unresolvable",
        mismatchReasons: undefined,
      });
      expect(r.state).toEqual(INITIAL_REVIEW_STATE);
    });

    it("submits unresolvable with optional reasons", () => {
      const withReason = transition(
        unresolvable,
        { type: "TOGGLE_REASON", reason: "not-a-card" },
        NO_PREDICTION,
      ).state;
      const r = transition(withReason, { type: "SUBMIT" }, NO_PREDICTION);
      expect(r.save).toEqual({
        verdict: "unresolvable",
        mismatchReasons: ["not-a-card"],
      });
    });

    it("escape discards the pending verdict", () => {
      const r = transition(corrected, { type: "CANCEL" }, HAS_PREDICTION);
      expect(r.state).toEqual(INITIAL_REVIEW_STATE);
      expect(r.save).toBeUndefined();
    });

    it("recovers to focus if pending is somehow missing", () => {
      const broken: ReviewMachineState = { phase: "reason", pending: null };
      const r = transition(broken, { type: "SUBMIT" }, HAS_PREDICTION);
      expect(r.state).toEqual(INITIAL_REVIEW_STATE);
      expect(r.save).toBeUndefined();
    });
  });
});
