import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { DATA_DIR } from "../../config";
import { importPack } from "./import";

/**
 * Downloads a prebuilt embedding pack and imports it.
 *
 * Embedding the catalog locally is hours of CPU; importing a pack is seconds.
 * This is the path a normal install is expected to take, so it has to work
 * without the user knowing what a pack is or where it lives on disk.
 *
 * State is a module-level singleton polled over HTTP rather than an SSE stream:
 * the whole operation is a download plus a ~20 s insert, and a second job
 * protocol is not worth the machinery.
 */

export type PackJobPhase =
  | "idle"
  | "downloading"
  | "importing"
  | "completed"
  | "failed";

export interface PackJobState {
  phase: PackJobPhase;
  url: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  imported: number;
  cards: number;
  message: string | null;
  startedAt: string | null;
}

let state: PackJobState = {
  phase: "idle",
  url: null,
  downloadedBytes: 0,
  totalBytes: null,
  imported: 0,
  cards: 0,
  message: null,
  startedAt: null,
};

export function getPackJobState(): PackJobState {
  return state;
}

/**
 * Where published packs live. Overridable so a maintainer can test a pack
 * before it is released, and so forks do not have to patch source.
 */
const DEFAULT_TEMPLATE =
  process.env.POKE_SORT_PACK_URL_TEMPLATE ??
  "https://github.com/cmakohon/poke-sort/releases/latest/download/{game}-{lang}.pack.gz";

export function packUrlFor(gameKey: string, lang: string): string {
  return DEFAULT_TEMPLATE.replace("{game}", gameKey).replace("{lang}", lang);
}

async function download(url: string, target: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Pack download failed: HTTP ${res.status}`);
  }

  const length = res.headers.get("content-length");
  state = {
    ...state,
    totalBytes: length ? Number(length) : null,
    downloadedBytes: 0,
  };

  const body = Readable.fromWeb(res.body as NodeWebReadableStream<Uint8Array>);
  body.on("data", (chunk: Buffer) => {
    state = {
      ...state,
      downloadedBytes: state.downloadedBytes + chunk.length,
    };
  });

  await mkdir(path.dirname(target), { recursive: true });
  await pipeline(body, createWriteStream(target));
}

/**
 * Runs the download+import in the background and returns immediately; callers
 * poll `getPackJobState`. Rejects a second concurrent run rather than queueing.
 */
export function startPackImport(
  gameKey: string,
  lang: string,
  urlOverride?: string,
): { started: boolean; message: string } {
  if (state.phase === "downloading" || state.phase === "importing") {
    return { started: false, message: "A catalog import is already running." };
  }

  const url = urlOverride?.trim() || packUrlFor(gameKey, lang);
  const target = path.join(DATA_DIR, "packs", `${gameKey}-${lang}.pack.gz`);

  state = {
    phase: "downloading",
    url,
    downloadedBytes: 0,
    totalBytes: null,
    imported: 0,
    cards: 0,
    message: null,
    startedAt: new Date().toISOString(),
  };

  void (async () => {
    try {
      // A local path is allowed so a maintainer can verify a pack before
      // publishing it.
      const isLocal = !/^https?:\/\//i.test(url);
      if (isLocal) {
        await stat(url);
        state = { ...state, phase: "importing", message: "Reading local pack" };
      } else {
        await download(url, target);
        state = { ...state, phase: "importing" };
      }

      const { header, inserted } = await importPack(
        isLocal ? url : target,
        (done, total) => {
          state = { ...state, imported: done, cards: total };
        },
      );

      state = {
        ...state,
        phase: "completed",
        imported: inserted,
        cards: header.count,
        message:
          `Imported ${inserted} of ${header.count} cards ` +
          `(${header.gameKey}/${header.lang}, built ${header.createdAt.slice(0, 10)}).`,
      };

      if (!isLocal) await rm(target, { force: true });
    } catch (err) {
      state = {
        ...state,
        phase: "failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  })();

  return { started: true, message: `Importing catalog from ${url}` };
}
