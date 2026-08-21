import type { MachineEventInput, MachineEventType } from "@poke-sort/shared";

/**
 * A buffered, batching sink for machine/serial telemetry.
 *
 * The renderer's console was the only witness to serial failures, and it
 * evaporates on restart. This log stamps every event (session, connection,
 * seq, wall-clock) and batches it to the server, where it becomes a queryable
 * machine_events row. Framework-free on purpose: like the request queue it
 * feeds off, it holds no React state and is unit-testable with fake timers.
 *
 * Delivery rules:
 * - a critical event (anything that describes a failure) flushes immediately;
 * - otherwise batches go every FLUSH_INTERVAL_MS, or sooner at FLUSH_AT_COUNT;
 * - a failed post re-buffers the batch and retries on the timer — and never
 *   records events about itself, because a telemetry feedback loop is worse
 *   than a telemetry gap;
 * - the buffer is capped; overflow drops the oldest events and reports the
 *   drop count as a single log_overflow event on the next flush.
 */

export interface MachineEventDraft {
  eventType: MachineEventType;
  command?: string;
  outcome?: MachineEventInput["outcome"];
  latencyMs?: number;
  payload?: Record<string, unknown>;
}

export interface MachineEventLog {
  readonly sessionId: string;
  record(event: MachineEventDraft): void;
  setConnectionId(id: string | null): void;
  flush(): Promise<void>;
  /** Empties the buffer for a last-gasp beacon (pagehide). */
  drain(): MachineEventInput[];
  dispose(): void;
}

const FLUSH_INTERVAL_MS = 2000;
const FLUSH_AT_COUNT = 25;
const BUFFER_CAP = 500;
/**
 * Ceiling per POST, not per flush — a flush loops over chunks. Two hard limits
 * sit above this: the server rejects batches over 500 events, and Chromium
 * rejects keepalive bodies over 64 KiB. A retry batch that breaches either
 * would be re-buffered and rebuilt identically every 2 s, wedging telemetry
 * forever; 100 events (~30 KB worst case) clears both with margin.
 */
export const MAX_POST_EVENTS = 100;

/** Event types that describe a failure and should not wait out the timer.
 *  Exchanges are critical too whenever their outcome is not "ok". */
const CRITICAL_TYPES: ReadonlySet<MachineEventType> = new Set([
  "queue_reset",
  "reboot_detected",
  "unplug",
  "stream_ended",
  "disconnect",
  "boot_test_fail",
  "boot_sync_failed",
  "boot_test_skipped",
  "connect_failed",
  "port_open_failed",
  "read_error",
] satisfies MachineEventType[]);

export function createMachineEventLog(
  post: (events: MachineEventInput[]) => Promise<void>,
): MachineEventLog {
  const sessionId = crypto.randomUUID();
  let connectionId: string | null = null;
  let seq = 0;
  let dropped = 0;
  let buffer: MachineEventInput[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let disposed = false;

  const stamp = (draft: MachineEventDraft): MachineEventInput => ({
    sessionId,
    connectionId: connectionId ?? undefined,
    seq: seq++,
    ts: Date.now(),
    ...draft,
  });

  const armTimer = () => {
    if (timer !== null || disposed) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, FLUSH_INTERVAL_MS);
  };

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const trimToCap = () => {
    if (buffer.length > BUFFER_CAP) {
      dropped += buffer.length - BUFFER_CAP;
      buffer = buffer.slice(buffer.length - BUFFER_CAP);
    }
  };

  const takeBatch = (): MachineEventInput[] => {
    const batch = buffer;
    buffer = [];
    if (dropped > 0) {
      batch.push(
        stamp({ eventType: "log_overflow", payload: { dropped } }),
      );
      dropped = 0;
    }
    return batch;
  };

  const flush = (): Promise<void> => {
    if (inFlight) {
      // Let the current post finish, then pick up whatever it left behind.
      return inFlight.then(() => flush());
    }
    if (buffer.length === 0 && dropped === 0) return Promise.resolve();
    clearTimer();
    const batch = takeBatch();
    inFlight = (async () => {
      for (let i = 0; i < batch.length; i += MAX_POST_EVENTS) {
        try {
          await post(batch.slice(i, i + MAX_POST_EVENTS));
        } catch {
          // Re-buffer this chunk and everything after it, ahead of anything
          // recorded meanwhile, and retry on the timer. Deliberately no event
          // about the failure itself.
          buffer = batch.slice(i).concat(buffer);
          trimToCap();
          armTimer();
          return;
        }
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    sessionId,

    record(draft) {
      if (disposed) return;
      buffer.push(stamp(draft));
      trimToCap();
      const critical =
        CRITICAL_TYPES.has(draft.eventType) ||
        (draft.eventType === "exchange" && draft.outcome !== "ok");
      if (critical || buffer.length >= FLUSH_AT_COUNT) {
        void flush();
      } else {
        armTimer();
      }
    },

    setConnectionId(id) {
      connectionId = id;
    },

    flush,

    drain() {
      clearTimer();
      const batch = takeBatch();
      return batch;
    },

    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}
