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
