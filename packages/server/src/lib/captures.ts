import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CAPTURES_DIR } from "../config";

/**
 * Scan captures live on disk, not in the database.
 *
 * `collection_cards.captured_image_data_url` held a base64 JPEG in a text
 * column. At ~150 KB per scan that is ~1.5 GB per 10k cards inside a WASM
 * database — enough to make every query on the table slow and the data
 * directory unmanageable. Files are named by the scan guid, which makes the
 * mapping back to a row trivial and deletion a single unlink.
 */

const DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/s;

function extensionFor(mime: string): string {
  return mime === "jpg" ? "jpeg" : mime;
}

/** Guid comes from the URL, so never let it escape the captures directory. */
function resolveSafe(fileName: string): string | null {
  const resolved = path.resolve(CAPTURES_DIR, fileName);
  const root = path.resolve(CAPTURES_DIR);
  return resolved.startsWith(root + path.sep) ? resolved : null;
}

/**
 * Writes a data-URL capture to disk and returns the stored file name, or null
 * if the value is not a data URL (already a path, or absent).
 */
export async function saveCapture(
  scanId: string,
  dataUrl: string | null | undefined,
): Promise<string | null> {
  if (!dataUrl) return null;
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null;

  const [, mime, base64] = match;
  const fileName = `${scanId}.${extensionFor(mime)}`;
  const target = resolveSafe(fileName);
  if (!target) return null;

  await mkdir(CAPTURES_DIR, { recursive: true });
  await writeFile(target, Buffer.from(base64, "base64"));
  return fileName;
}

export async function readCapture(
  fileName: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const target = resolveSafe(fileName);
  if (!target) return null;
  try {
    const body = await readFile(target);
    const ext = path.extname(target).slice(1).toLowerCase();
    return { body, contentType: `image/${ext === "jpg" ? "jpeg" : ext}` };
  } catch {
    return null;
  }
}

/** Best-effort: a leftover file is a wasted 150 KB, not a correctness problem. */
export async function deleteCaptures(fileNames: (string | null)[]): Promise<void> {
  await Promise.all(
    fileNames.filter((n): n is string => !!n).map(async (name) => {
      const target = resolveSafe(name);
      if (target) await rm(target, { force: true });
    }),
  );
}

/** The URL the client puts in an `<img src>`; `/api` is stripped by the proxy. */
export function captureUrl(fileName: string | null | undefined): string | undefined {
  return fileName ? `/api/captures/${encodeURIComponent(fileName)}` : undefined;
}
