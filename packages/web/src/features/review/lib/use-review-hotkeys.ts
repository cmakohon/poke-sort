import { isDialogOpen } from "@/lib/dialog-open";
import { useEffect, useRef } from "react";

/** Keys that press a focused control — never stolen from one. */
const ACTIVATION_KEYS = new Set([" ", "Enter"]);
/** Keys that change a focused control's value, on top of the above. */
const VALUE_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
]);

const TEXT_ENTRY = (el: HTMLElement) =>
  el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
const PRESSABLE = "button, a[href], [role='button'], [role='menuitem']";
const VALUE_BEARING = "select, [role='switch'], [role='option']";

/**
 * One document-level keydown listener for the review screen.
 *
 * A focused control withholds only the keys that would operate it, not the
 * whole keyboard. The guard used to treat any focused button or switch as
 * having claimed every key, which meant that clicking refresh, help or the
 * "show reviewed" switch — or just closing an enlarged capture, which returns
 * focus to the button that opened it — left the operator pressing verdict keys
 * at a screen that had stopped listening. Space and Enter still stand down, so
 * a verdict is never recorded when the user meant to press the control under
 * their finger; the letters and digits that are the actual verdicts always
 * fire.
 *
 * Typing is different: while a text field has focus every key belongs to it,
 * Escape excepted — that has to work from inside the search input and the note
 * field, or there is no keyboard way out.
 *
 * An open dialog silences everything, Escape included. Enlarging a capture
 * puts one over the whole screen, and a verdict key pressed there would answer
 * a card the operator can no longer see — Escape worst of all, since it would
 * both close the image and skip the card in one press.
 *
 * Return true from the handler to preventDefault (Space scrolling the page,
 * `/` opening quick-find in some browsers).
 */
export function useReviewHotkeys(
  handler: (e: KeyboardEvent) => boolean | void,
  enabled = true,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isDialogOpen()) return;
      const target = e.target as HTMLElement;
      if (TEXT_ENTRY(target)) {
        if (e.key !== "Escape") return;
      } else if (
        target.closest?.(VALUE_BEARING) != null &&
        (ACTIVATION_KEYS.has(e.key) || VALUE_KEYS.has(e.key))
      ) {
        return;
      } else if (
        target.closest?.(PRESSABLE) != null &&
        ACTIVATION_KEYS.has(e.key)
      ) {
        return;
      }
      if (handlerRef.current(e)) e.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
