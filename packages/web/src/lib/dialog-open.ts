/**
 * Is a modal dialog currently on screen?
 *
 * Several screens bind document-level keyboard shortcuts — the card detail
 * panel takes Escape and the arrows, the review screen takes Escape, Space,
 * 1-9 and a handful of letters. An enlarged card image is a dialog on top of
 * those screens, so without this check Escape would dismiss the image *and*
 * close the panel or record a verdict behind it, and a number key would answer
 * a card the operator can no longer see.
 *
 * Read off the DOM rather than tracked in state because the shortcut handlers
 * and the dialog live in different trees; the dialog primitive stamps
 * data-open on its content for exactly this kind of check.
 */
export function isDialogOpen(): boolean {
  return !!document.querySelector('[data-slot="dialog-content"][data-open]');
}
