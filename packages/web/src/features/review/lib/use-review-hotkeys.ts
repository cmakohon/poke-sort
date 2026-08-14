import { useEffect, useRef } from "react";

/**
 * One document-level keydown listener for the review screen.
 *
 * Same guard as the sidebar's `[` shortcut: never fire while the user is
 * typing. Escape is the one exception — it must work from inside the search
 * input and the note field, otherwise there is no keyboard way out.
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
      const typing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (typing && e.key !== "Escape") return;
      if (handlerRef.current(e)) e.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
