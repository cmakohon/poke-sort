import { useEffect, useRef } from "react";

/**
 * One document-level keydown listener for the review screen.
 *
 * Same guard as the sidebar's `[` shortcut, extended to every interactive
 * element: never fire while the user is typing, and never steal Space/Enter
 * from a focused button or switch — that would record a verdict when the
 * user meant to press the control. Escape is the one exception — it must
 * work from inside the search input and the note field, otherwise there is
 * no keyboard way out.
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
      const target = e.target as HTMLElement;
      const claimed =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        target.closest?.(
          "button, a[href], select, [role='button'], [role='switch'], [role='menuitem'], [role='option']",
        ) != null;
      if (claimed && e.key !== "Escape") return;
      if (handlerRef.current(e)) e.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
