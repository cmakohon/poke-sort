import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { VISION_OCR_BIN } from "../../config";
import type { TextRecognizer } from "./ocr";

/**
 * Apple Vision as a TextRecognizer, over a pool of sidecar processes.
 *
 * Vision is a scene-text recogniser: detection plus recognition trained on
 * photographs, with no binarisation step. Tesseract is a document engine whose
 * adaptive binarisation smears foil texture into glyphs, which is what the
 * whole escalation ladder in ocr.ts exists to work around. On the 1068-capture
 * real set that difference is 269 collector numbers against 936, at zero
 * confidently-wrong reads and a sixth of the time — see
 * docs/vision-ocr-evaluation.md.
 *
 * macOS only. Everything here is written so that absence, a missing Swift
 * toolchain, and a sidecar that dies mid-run are all ordinary states that end
 * in "use Tesseract instead" rather than a failed scan.
 */

/**
 * Matches the Tesseract pool for the same reason it is 2 there: the SigLIP
 * forward pass is competing for the same cores at the same moment, and OCR
 * that wins those cores just moves the bottleneck.
 */
const POOL_SIZE = Number(process.env.OCR_POOL_SIZE) || 2;

interface Reply {
  id: number;
  text: string;
  confidence: number;
  error?: string;
}

/** Raised when the sidecar is gone; the caller's job is to fall back, not retry. */
export class VisionUnavailable extends Error {}

/**
 * One sidecar process, one read at a time.
 *
 * Strictly serial rather than many in flight: Vision parallelises across
 * processes perfectly well, and a serial protocol means a dropped or malformed
 * line cannot pair a reply with the wrong crop. That failure would not throw —
 * it would quietly score one band's text against another band's card.
 */
class VisionWorker {
  private proc: ChildProcess;
  private buffer = "";
  private pending: { resolve: (r: Reply) => void; reject: (e: Error) => void } | null = null;
  private nextId = 1;
  dead = false;
  readonly scratch: string;

  constructor(scratchDir: string, index: number) {
    this.scratch = path.join(scratchDir, `w${index}.png`);
    this.proc = spawn(VISION_OCR_BIN, [], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout!.setEncoding("utf-8");
    this.proc.stdout!.on("data", (chunk: string) => this.onData(chunk));
    this.proc.stderr!.setEncoding("utf-8");
    this.proc.stderr!.on("data", (c: string) => console.error(`[vision] ${c.trim()}`));
    // A sidecar that exits takes its in-flight read with it. Without this the
    // caller waits forever on a promise nothing will ever settle, which on a
    // sorter means the feeder stalls mid-card.
    const die = (why: string) => {
      this.dead = true;
      const p = this.pending;
      this.pending = null;
      p?.reject(new VisionUnavailable(`vision sidecar ${why}`));
    };
    this.proc.on("exit", (code, signal) => die(`exited (${code ?? signal})`));
    this.proc.on("error", (err) => die(`failed to start: ${err.message}`));
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (!line.trim()) continue;
      const p = this.pending;
      this.pending = null;
      if (!p) continue;
      try {
        p.resolve(JSON.parse(line) as Reply);
      } catch (err) {
        p.reject(new VisionUnavailable(`unparseable reply: ${String(err)}`));
      }
    }
  }

  async read(png: Buffer): Promise<Reply> {
    if (this.dead) throw new VisionUnavailable("sidecar is gone");
    // Reused per worker rather than a fresh file per read: the worker is
    // serial, so the previous crop is always consumed before this overwrites it.
    await writeFile(this.scratch, png);
    const id = this.nextId++;
    return new Promise<Reply>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.proc.stdin!.write(JSON.stringify({ id, path: this.scratch }) + "\n", (err) => {
        if (err) {
          this.pending = null;
          reject(new VisionUnavailable(`write failed: ${err.message}`));
        }
      });
    });
  }

  kill() {
    this.dead = true;
    this.proc.stdin!.end();
    this.proc.kill();
  }
}

let pool: VisionWorker[] | null = null;
let scratchDir: string | null = null;
let free: VisionWorker[] = [];
const waiters: ((w: VisionWorker) => void)[] = [];
let starting: Promise<void> | null = null;

async function ensurePool(): Promise<void> {
  if (pool) return;
  if (!starting) {
    starting = (async () => {
      if (!existsSync(VISION_OCR_BIN)) {
        throw new VisionUnavailable(`no sidecar at ${VISION_OCR_BIN}`);
      }
      const dir = await mkdtemp(path.join(os.tmpdir(), "poke-vision-"));
      const workers = Array.from({ length: POOL_SIZE }, (_, i) => new VisionWorker(dir, i));
      scratchDir = dir;
      pool = workers;
      free = [...workers];
    })().catch((err) => {
      starting = null;
      throw err;
    });
  }
  return starting;
}

function acquire(): Promise<VisionWorker> {
  const w = free.pop();
  if (w) return Promise.resolve(w);
  return new Promise((resolve) => waiters.push(resolve));
}

function release(w: VisionWorker) {
  // A dead worker is not handed back out; the pool shrinks and probeVision's
  // result is what decides whether Vision is used at all next time.
  if (w.dead) {
    pool = pool?.filter((x) => x !== w) ?? null;
    return;
  }
  const next = waiters.shift();
  if (next) next(w);
  else free.push(w);
}

/** PNG in, recognised text out. Throws VisionUnavailable when the sidecar is gone. */
export const visionRecognizer: TextRecognizer = async (png) => {
  await ensurePool();
  if (!pool || pool.length === 0) throw new VisionUnavailable("pool is empty");
  const worker = await acquire();
  try {
    const reply = await worker.read(png);
    // A per-read error (an undecodable crop) is not a dead sidecar — it is one
    // empty reading, which the re-ranker already treats as "no evidence".
    if (reply.error) {
      console.error(`[vision] read error: ${reply.error}`);
      return "";
    }
    return reply.text.trim();
  } finally {
    release(worker);
  }
};

/**
 * Whether Vision actually works here, decided by using it once rather than by
 * inspecting the platform.
 *
 * A binary can exist and still not run — wrong architecture, quarantined by
 * Gatekeeper, built against a newer macOS. Those all look identical to a
 * present file, and each would otherwise surface as every scan silently
 * reading nothing.
 */
export async function probeVision(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  if (!existsSync(VISION_OCR_BIN)) return false;
  try {
    await ensurePool();
    // A blank crop is a valid input with a knowable answer: no text. What is
    // under test is the round trip, not the recognition.
    const png = await sharp({
      create: { width: 64, height: 32, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    await visionRecognizer(png);
    return true;
  } catch (err) {
    console.warn(`[vision] unavailable, falling back to Tesseract: ${String(err)}`);
    return false;
  }
}

export async function disposeVision(): Promise<void> {
  if (pool) for (const w of pool) w.kill();
  pool = null;
  free = [];
  starting = null;
  if (scratchDir) await rm(scratchDir, { recursive: true, force: true }).catch(() => {});
  scratchDir = null;
}
