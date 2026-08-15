/**
 * Hands a string to the browser as a file.
 *
 * The same six lines in the desktop shell: Chromium turns `a.download` into a
 * save dialog, so no Electron IPC or preload surface is needed to write a file
 * where a person wants it.
 */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string,
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Date stamp for generated filenames, e.g. `2026-08-14`. */
export function fileDateSuffix(): string {
  return new Date().toISOString().slice(0, 10);
}
