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
 * toolchain, and a sidecar that dies or wedges mid-run are all ordinary states
 * that end in "use Tesseract instead" rather than a failed or hanging scan.
 * A scan blocked forever is the worst outcome available: the feeder has
 * already committed the card.
 */

/**
 * Matches the Tesseract pool for the same reason it is 2 there: the SigLIP
 * forward pass is competing for the same cores at the same moment, and OCR
 * that wins those cores just moves the bottleneck.
 */
const POOL_SIZE = Number(process.env.OCR_POOL_SIZE) || 2;

/**
 * How long one read may take before the worker is treated as wedged.
 *
 * Process *exit* is observable; a sidecar that is alive and simply not
 * answering is not. Vision returns in tens of milliseconds, and identification
 * runs to a 2s budget, so this is far outside anything real and exists only to
 * convert a hang into the degradation this module already promises.
 */
const READ_TIMEOUT_MS = Number(process.env.VISION_READ_TIMEOUT_MS) || 5000;

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
  private timer: NodeJS.Timeout | null = null;
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
    this.proc.on("exit", (code, signal) => this.die(`exited (${code ?? signal})`));
    this.proc.on("error", (err) => this.die(`failed to start: ${err.message}`));
    // Node emits 'error' on the STREAM as well as calling write's callback, and
    // an unhandled stream 'error' is an uncaught exception that takes the
    // server down. The window is real: the sidecar exits, the 'exit' event has
    // not been delivered yet, and a queued read writes into the broken pipe —
    // i.e. exactly the non-runnable-binary cases probeVision exists to absorb.
    this.proc.stdin!.on("error", (err: Error) => this.die(`stdin: ${err.message}`));
  }

  /**
   * The worker is finished. Settles whatever it was holding and tells the pool,
   * which is what wakes anyone queued behind it.
   */
  private die(why: string) {
    const first = !this.dead;
    this.dead = true;
    this.settle(null, new VisionUnavailable(`vision sidecar ${why}`));
    if (first) onWorkerDeath(this);
  }

  private settle(reply: Reply | null, err: Error | null) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    if (err) p.reject(err);
    else p.resolve(reply!);
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        this.settle(JSON.parse(line) as Reply, null);
      } catch (err) {
        this.settle(null, new VisionUnavailable(`unparseable reply: ${String(err)}`));
      }
    }
  }

  async read(png: Buffer): Promise<Reply> {
    if (this.dead) throw new VisionUnavailable("sidecar is gone");
    // The serial protocol is only serial if the pool honours it. A second
    // concurrent read would overwrite `pending`, stranding the first promise
    // and resolving the second with the first crop's text — the silent
    // mispairing this class is shaped to prevent. Fail loudly instead.
    if (this.pending) throw new VisionUnavailable("worker is already reading");
    // Reused per worker rather than a fresh file per read: the worker is
    // serial, so the previous crop is always consumed before this overwrites it.
    await writeFile(this.scratch, png);
    const id = this.nextId++;
    return new Promise<Reply>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.timer = setTimeout(
        () => this.die(`did not answer within ${READ_TIMEOUT_MS}ms`),
        READ_TIMEOUT_MS,
      );
      this.proc.stdin!.write(JSON.stringify({ id, path: this.scratch }) + "\n", (err) => {
        if (err) this.settle(null, new VisionUnavailable(`write failed: ${err.message}`));
      });
    });
  }

  kill() {
    this.dead = true;
    this.settle(null, new VisionUnavailable("disposed"));
    this.proc.stdin!.end();
    this.proc.kill();
  }
}

let pool: VisionWorker[] | null = null;
let scratchDir: string | null = null;
let free: VisionWorker[] = [];
let waiters: { resolve: (w: VisionWorker) => void; reject: (e: Error) => void }[] = [];
let starting: Promise<void> | null = null;

function rejectWaiters(err: Error) {
  const queued = waiters;
  waiters = [];
  for (const w of queued) w.reject(err);
}

/**
 * A worker is gone: drop it, and if it was the last one, unblock everybody
 * waiting on it.
 *
 * The waiters are the whole reason this is not just a filter. One read of a
 * card fans out over more crops than there are workers, so callers are
 * routinely parked here — and a queued caller that is never woken never
 * settles, which stalls the scan, the HTTP request, and then the graceful
 * shutdown that is waiting for that request to finish.
 */
function onWorkerDeath(dead: VisionWorker) {
  pool = pool?.filter((w) => w !== dead) ?? null;
  free = free.filter((w) => w !== dead);
  if (!pool || pool.length === 0) {
    rejectWaiters(new VisionUnavailable("all vision sidecars are gone"));
  }
}

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
      // A worker can die during construction (bad binary), and onWorkerDeath
      // runs before this assignment — so filter rather than trust the array.
      pool = workers.filter((w) => !w.dead);
      free = [...pool];
      if (pool.length === 0) throw new VisionUnavailable("no sidecar survived startup");
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
  return new Promise<VisionWorker>((resolve, reject) => waiters.push({ resolve, reject }));
}

function release(w: VisionWorker) {
  if (w.dead) {
    // die() already routed through onWorkerDeath; nothing to hand back.
    onWorkerDeath(w);
    return;
  }
  const next = waiters.shift();
  if (next) next.resolve(w);
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
  const workers = pool;
  pool = null;
  free = [];
  starting = null;
  // Before killing anything: a caller parked in acquire() has no worker to be
  // woken by, and leaving the queue populated would also let a stale resolver
  // survive into a later pool and be handed a worker somebody else is using.
  rejectWaiters(new VisionUnavailable("vision disposed"));
  if (workers) for (const w of workers) w.kill();
  if (scratchDir) await rm(scratchDir, { recursive: true, force: true }).catch(() => {});
  scratchDir = null;
}
