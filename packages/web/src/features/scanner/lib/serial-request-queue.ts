// The framework-free core of the serial layer: one command in flight at a
// time, each reply paired with the command that asked for it.
//
// The Arduino answers every command with exactly one line, but it also prints
// lines nobody asked for (jam alerts, the boot banner). The old layer handed
// every incoming line to a FIFO of waiters, so any unsolicited line — or any
// reply to a command whose sender never read it — shifted the pairing by one,
// and every exchange after that got the previous command's answer until the
// app gave up and reconnected. This queue holds a mutex across write-then-read
// instead, and the provider filters unsolicited lines before they reach it.

export interface SerialRequestResult {
  /** False when the write itself failed (no port, writer error). */
  sent: boolean;
  /** The reply line, or null when none arrived before the timeout. */
  response: string | null;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * True for lines the firmware emits on its own rather than in reply to a
 * command. Newer firmware marks these with `"unsolicited":true`; the
 * status/error matches keep the classifier working against firmware flashed
 * before the marker existed. Non-JSON lines classify as solicited — a garbled
 * line is far more likely a mangled reply than spontaneous output.
 */
export function isUnsolicitedLine(line: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) return false;
  const msg = parsed as Record<string, unknown>;
  return (
    msg.unsolicited === true || msg.error === "jam" || msg.status === "ready"
  );
}

interface Job {
  /** Coalescing key; null for plain requests. */
  key: string | null;
  data: string;
  timeoutMs: number;
  resolvers: Array<(result: SerialRequestResult) => void>;
}

export interface SerialRequestQueue {
  /** Write `data`, then resolve with the next solicited line (or timeout). */
  request(data: string, timeoutMs?: number): Promise<SerialRequestResult>;
  /**
   * Like request, but while a job with the same key is still queued (not yet
   * written), replace its payload instead of queueing another. All callers
   * resolve with the result of the exchange that actually ran — built for
   * slider drags, which produce values faster than the link can drain them
   * and only ever care about the latest one.
   */
  requestLatest(
    key: string,
    data: string,
    timeoutMs?: number,
  ): Promise<SerialRequestResult>;
  /** Feed one solicited line from the read loop. */
  handleLine(line: string): void;
  /** Fail everything in flight and queued; call on disconnect. */
  reset(): void;
}

export function createSerialRequestQueue(
  write: (data: string) => Promise<boolean>,
): SerialRequestQueue {
  const queue: Job[] = [];
  let replyWaiter: ((line: string | null) => void) | null = null;
  let pumping = false;

  const settle = (job: Job, result: SerialRequestResult) => {
    for (const resolve of job.resolvers) resolve(result);
  };

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      let job: Job | undefined;
      while ((job = queue.shift())) {
        const current = job;
        // Arm the waiter before writing so a reply that lands while the write
        // is still settling cannot slip past it.
        const reply = new Promise<string | null>((resolve) => {
          const timer = setTimeout(() => {
            replyWaiter = null;
            resolve(null);
          }, current.timeoutMs);
          replyWaiter = (line) => {
            clearTimeout(timer);
            replyWaiter = null;
            resolve(line);
          };
        });
        const sent = await write(current.data);
        if (!sent) {
          replyWaiter?.(null);
          settle(current, { sent: false, response: null });
          continue;
        }
        const line = await reply;
        settle(current, { sent: true, response: line });
      }
    } finally {
      pumping = false;
    }
  };

  const enqueue = (key: string | null, data: string, timeoutMs: number) =>
    new Promise<SerialRequestResult>((resolve) => {
      queue.push({ key, data, timeoutMs, resolvers: [resolve] });
      void pump();
    });

  return {
    request(data, timeoutMs = DEFAULT_TIMEOUT_MS) {
      return enqueue(null, data, timeoutMs);
    },

    requestLatest(key, data, timeoutMs = DEFAULT_TIMEOUT_MS) {
      const waiting = queue.find((j) => j.key === key);
      if (waiting) {
        waiting.data = data;
        waiting.timeoutMs = timeoutMs;
        return new Promise<SerialRequestResult>((resolve) => {
          waiting.resolvers.push(resolve);
        });
      }
      return enqueue(key, data, timeoutMs);
    },

    handleLine(line) {
      replyWaiter?.(line);
    },

    reset() {
      const flushed = queue.splice(0, queue.length);
      for (const job of flushed) settle(job, { sent: false, response: null });
      replyWaiter?.(null);
    },
  };
}
