import { useReviewHotkeys } from "@/features/review/lib/use-review-hotkeys";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const press = (key: string, target: EventTarget = document.body) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });

/** Stands in for an enlarged card image, which is what puts one on screen. */
function openADialog() {
  const el = document.createElement("div");
  el.setAttribute("data-slot", "dialog-content");
  el.setAttribute("data-open", "");
  document.body.appendChild(el);
  return el;
}

describe("useReviewHotkeys", () => {
  it("passes keys through when nothing is in the way", () => {
    const handler = vi.fn();
    renderHook(() => useReviewHotkeys(handler));
    press("x");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  /**
   * Enlarging a capture covers the whole screen. A verdict key pressed there
   * would answer a card the operator can no longer see — and Escape is the
   * worst of them, since it would close the image and skip the card in one
   * press.
   */
  it("stands down entirely while a dialog is open", () => {
    const handler = vi.fn();
    renderHook(() => useReviewHotkeys(handler));

    const dialog = openADialog();
    for (const key of ["x", " ", "1", "Escape", "j"]) press(key);
    expect(handler).not.toHaveBeenCalled();

    dialog.remove();
    press("x");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  /**
   * The regression this guard exists to prevent, and the one it used to cause.
   * Clicking refresh or help left the button focused, and the old guard read
   * that as "the button owns the keyboard" — so every verdict key went dead
   * until the operator clicked somewhere else.
   */
  it("keeps firing verdict keys while a button has focus", () => {
    const handler = vi.fn();
    renderHook(() => useReviewHotkeys(handler));
    const button = document.createElement("button");
    document.body.appendChild(button);

    for (const key of ["x", "1", "c", "j"]) press(key, button);
    expect(handler).toHaveBeenCalledTimes(4);
  });

  it("never steals the keys that press the focused control", () => {
    const handler = vi.fn();
    renderHook(() => useReviewHotkeys(handler));
    const button = document.createElement("button");
    document.body.appendChild(button);

    press(" ", button);
    press("Enter", button);
    expect(handler).not.toHaveBeenCalled();
  });

  it("leaves a switch its arrows as well", () => {
    const handler = vi.fn();
    renderHook(() => useReviewHotkeys(handler));
    const toggle = document.createElement("div");
    toggle.setAttribute("role", "switch");
    document.body.appendChild(toggle);

    press("ArrowRight", toggle);
    press(" ", toggle);
    expect(handler).not.toHaveBeenCalled();
    // ...but not the letters, which are not its to take.
    press("v", toggle);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("still ignores typing, and still lets Escape out of an input", () => {
    const handler = vi.fn();
    renderHook(() => useReviewHotkeys(handler));
    const input = document.createElement("input");
    document.body.appendChild(input);

    press("s", input);
    expect(handler).not.toHaveBeenCalled();
    press("Escape", input);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
