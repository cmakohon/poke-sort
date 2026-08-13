import { reportSerialEvent } from "@/features/notifications/api/notification-settings";
import {
  beaconMachineEvents,
  postMachineEvents,
} from "@/features/scanner/api/machine-events";
import { createMachineEventLog } from "@/features/scanner/lib/machine-event-log";
import {
  createSerialRequestQueue,
  isUnsolicitedLine,
  type SerialQueueEvent,
} from "@/features/scanner/lib/serial-request-queue";
import type {
  SerialContextValue,
  SerialMessageListener,
} from "@/features/scanner/types";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export type { SerialMessageListener } from "@/features/scanner/types";

const SerialContext = createContext<SerialContextValue | null>(null);

/** The command key of a sent line ("bin", "servo", "test"…), for telemetry. */
function commandOf(data: string): string | undefined {
  try {
    return Object.keys(JSON.parse(data))[0];
  } catch {
    return undefined;
  }
}

export function SerialProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("scanner");
  const [isConnected, setIsConnected] = useState(false);
  const [isReady, setIsReady] = useState(false);
  // Mirror of isReady for the reboot listener, which must read it without
  // re-subscribing on every state change.
  const isReadyRef = useRef(false);
  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null,
  );
  const writableRef = useRef<WritableStream<Uint8Array> | null>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const bufferRef = useRef("");
  const listenersRef = useRef(new Set<SerialMessageListener>());
  const disconnectingRef = useRef<Promise<void> | null>(null);
  const preTestHooksRef = useRef(new Set<() => Promise<void>>());

  const decoderRef = useRef(new TextDecoder());

  // Durable telemetry: every exchange and lifecycle event goes to the
  // machine_events table via this log, so a disconnect can be diagnosed after
  // the fact instead of from whatever DevTools happened to still show.
  const logRef = useRef<ReturnType<typeof createMachineEventLog> | null>(null);
  if (logRef.current === null) {
    logRef.current = createMachineEventLog(postMachineEvents);
  }
  const log = logRef.current;

  // pagehide is the last chance to get the tail of the buffer out; fetch
  // promises are not guaranteed to run once the page is going away.
  useEffect(() => {
    const handler = () => beaconMachineEvents(log.drain());
    window.addEventListener("pagehide", handler);
    return () => window.removeEventListener("pagehide", handler);
  }, [log]);

  const writeRaw = useCallback((data: string): Promise<boolean> => {
    if (!portRef.current || !writableRef.current) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
      writeQueueRef.current = writeQueueRef.current.then(async () => {
        if (!writableRef.current) {
          resolve(false);
          return;
        }
        const writer = writableRef.current.getWriter();
        try {
          console.log("[Serial] →", data.trim()); // eslint-disable-line no-console -- hardware debug trace
          await writer.write(new TextEncoder().encode(data));
          resolve(true);
        } catch {
          resolve(false);
        } finally {
          writer.releaseLock();
        }
      });
    });
  }, []);

  // One command in flight at a time, each reply paired with the command that
  // asked for it — see serial-request-queue.ts for why the FIFO-of-waiters
  // approach this replaces lost the link during calibration.
  const queueRef = useRef<ReturnType<typeof createSerialRequestQueue> | null>(
    null,
  );
  if (queueRef.current === null) {
    const onEvent = (event: SerialQueueEvent) => {
      const eventLog = logRef.current;
      if (!eventLog) return;
      if (event.type === "reset") {
        eventLog.record({
          eventType: "queue_reset",
          payload: {
            flushedJobs: event.flushedJobs,
            hadInflight: event.hadInflight,
          },
        });
        return;
      }
      eventLog.record({
        eventType: "exchange",
        command: commandOf(event.data),
        outcome: event.outcome,
        latencyMs: event.latencyMs,
        payload: {
          sent: event.data.trim(),
          response: event.response,
          ...(event.coalesced > 0 ? { coalesced: event.coalesced } : {}),
        },
      });
    };
    queueRef.current = createSerialRequestQueue(writeRaw, { onEvent });
  }
  const queue = queueRef.current;

  const startReading = useCallback(
    async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      onEnd?: () => void,
    ) => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            bufferRef.current += decoderRef.current.decode(value, {
              stream: true,
            });
            const lines = bufferRef.current.split("\n");
            bufferRef.current = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              console.log("[Serial] ←", trimmed); // eslint-disable-line no-console -- hardware debug trace

              try {
                const parsed = JSON.parse(trimmed);
                for (const listener of listenersRef.current) {
                  listener(parsed);
                }
              } catch {
                console.warn("[Serial] Non-JSON message:", trimmed);
                log.record({
                  eventType: "rx_non_json",
                  payload: { line: trimmed },
                });
              }

              // Unsolicited traffic (jam alerts, the boot banner) goes to
              // subscribers only — handing it to a request waiter is what used
              // to shift every later exchange onto the wrong reply.
              if (!isUnsolicitedLine(trimmed)) {
                queue.handleLine(trimmed);
              } else {
                log.record({
                  eventType: "rx_unsolicited",
                  payload: { line: trimmed },
                });
              }
            }
          }
        }
      } catch (e) {
        // Reader was cancelled (disconnect) - expected
        if (!(e instanceof DOMException && e.name === "NetworkError")) {
          console.error("[Serial] Read error:", e);
          log.record({ eventType: "read_error", payload: { error: String(e) } });
        }
      } finally {
        onEnd?.();
      }
    },
    [queue, log],
  );

  const request = useCallback(
    (data: string, timeoutMs?: number) => queue.request(data + "\n", timeoutMs),
    [queue],
  );

  const requestLatest = useCallback(
    (key: string, data: string, timeoutMs?: number) =>
      queue.requestLatest(key, data + "\n", timeoutMs),
    [queue],
  );

  const sendTest = useCallback(async (): Promise<boolean> => {
    const { sent, response } = await request(
      JSON.stringify({ test: true }),
      10000,
    );
    if (!sent || !response) return false;

    try {
      const parsed = JSON.parse(response);
      return parsed.status === "test_complete";
    } catch {
      return false;
    }
  }, [request]);

  // Push stored calibration, then run the self-test. Runs on first connect
  // and again whenever the firmware reboots mid-session (watchdog recovery,
  // power blip): the sorter holds calibration in RAM only, so after any reset
  // it is back on the inert compiled defaults until this re-push.
  const runBootSequence = useCallback(
    async (port: SerialPort) => {
      for (const hook of [...preTestHooksRef.current]) {
        await hook();
        if (portRef.current !== port) return;
      }
      toast.info(t("serial.testingDevice"));
      const ok = await sendTest();
      if (portRef.current !== port) return;
      if (ok) {
        log.record({ eventType: "boot_test_pass" });
        toast.success(t("serial.deviceReady"));
      } else {
        log.record({ eventType: "boot_test_fail" });
        toast.error(t("serial.deviceTestFailed.title"), {
          description: t("serial.deviceTestFailed.description"),
        });
        void reportSerialEvent({
          command: "test",
          sent: true,
          response: null,
        });
      }
    },
    [sendTest, t, log],
  );

  const disconnect = useCallback(() => {
    const port = portRef.current;
    const reader = readerRef.current;

    // Before the queue reset so the events read in causal order.
    if (port) log.record({ eventType: "disconnect" });
    log.setConnectionId(null);

    // Clear refs and state immediately
    portRef.current = null;
    readerRef.current = null;
    writableRef.current = null;
    writeQueueRef.current = Promise.resolve();
    setIsConnected(false);
    setIsReady(false);
    isReadyRef.current = false;

    // Fail the in-flight request and everything queued behind it
    queue.reset();
    bufferRef.current = "";

    // Async cleanup - stored so connect() can await it
    const cleanup = (async () => {
      if (reader) {
        try {
          await reader.cancel();
        } catch {}
      }

      if (port) {
        try {
          await port.close();
        } catch {}
      }
    })();

    disconnectingRef.current = cleanup.finally(() => {
      disconnectingRef.current = null;
    });

    return cleanup;
  }, [queue, log]);

  // Resolves once the firmware's {"status":"ready"} banner arrives (the
  // Arduino resets when the port opens), or after timeoutMs — true when the
  // banner actually came. The banner is unsolicited, so it only ever reaches
  // subscribers — this cannot consume a command reply by accident.
  const waitForReady = useCallback((timeoutMs: number): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const finish = (arrived: boolean) => {
        clearTimeout(timer);
        listenersRef.current.delete(listener);
        resolve(arrived);
      };
      const listener: SerialMessageListener = (msg) => {
        if (
          typeof msg === "object" &&
          msg !== null &&
          (msg as Record<string, unknown>).status === "ready"
        ) {
          finish(true);
        }
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      listenersRef.current.add(listener);
    });
  }, []);

  const openPort = useCallback(
    async (port: SerialPort): Promise<boolean> => {
      if (!port.readable || !port.writable) {
        try {
          await port.open({ baudRate: 9600 });
        } catch (err) {
          log.record({
            eventType: "port_open_failed",
            payload: { error: String(err) },
          });
          toast.error(t("serial.connectionFailed.title"), {
            description: t("serial.connectionFailed.description"),
          });
          void reportSerialEvent({
            command: "connect",
            sent: false,
            response: null,
          });
          return false;
        }
      }

      portRef.current = port;
      writableRef.current = port.writable;

      const reader = port.readable!.getReader();
      readerRef.current = reader;
      decoderRef.current = new TextDecoder();

      log.setConnectionId(crypto.randomUUID());
      log.record({ eventType: "port_opened" });

      setIsConnected(true);

      startReading(reader, () => {
        if (portRef.current === port) {
          console.warn("[Serial] Stream ended unexpectedly, disconnecting");
          log.record({ eventType: "stream_ended" });
          disconnect();
        }
      });

      (async () => {
        // Wait out the Arduino's boot before pushing config at it
        const arrived = await waitForReady(5000);
        log.record({ eventType: "ready", payload: { timedOut: !arrived } });
        if (portRef.current !== port) return;
        await runBootSequence(port);
      })();

      return true;
    },
    [startReading, waitForReady, runBootSequence, disconnect, t, log],
  );

  const connect = useCallback(async () => {
    if (disconnectingRef.current) {
      await disconnectingRef.current;
    }
    if (portRef.current) return;

    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort();
    } catch (err) {
      // There is no picker to cancel. The Electron shell answers
      // `select-serial-port` itself and auto-selects the first port, so the
      // only way this rejects is that the shell found no ports at all — which
      // this used to swallow, leaving the Connect button doing nothing at all
      // with no explanation.
      if (err instanceof DOMException && err.name === "NotFoundError") {
        log.record({
          eventType: "connect_failed",
          payload: { reason: "no_device_found" },
        });
        toast.error(t("serial.noDeviceFound.title"), {
          description: t("serial.noDeviceFound.description"),
        });
        return;
      }
      console.error("[Serial] requestPort failed:", err);
      log.record({
        eventType: "connect_failed",
        payload: { error: String(err) },
      });
      toast.error(t("serial.connectionFailed.title"), {
        description: t("serial.connectionFailed.description"),
      });
      return;
    }

    await openPort(port);
  }, [openPort, t, log]);

  // Detect physical USB unplug
  useEffect(() => {
    if (!navigator.serial) return;
    const handleDisconnect = (event: Event) => {
      if (portRef.current && portRef.current === (event.target as SerialPort)) {
        console.warn("[Serial] Device unplugged");
        log.record({ eventType: "unplug" });
        disconnect();
      }
    };
    navigator.serial.addEventListener("disconnect", handleDisconnect);
    return () => {
      navigator.serial.removeEventListener("disconnect", handleDisconnect);
    };
  }, [disconnect, log]);

  useEffect(() => {
    const listener: SerialMessageListener = (msg) => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        "status" in msg &&
        (msg as Record<string, unknown>).status === "test_complete"
      ) {
        setIsReady(true);
        isReadyRef.current = true;
      }
    };
    const listeners = listenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // A ready banner arriving mid-session means the firmware rebooted under us
  // (watchdog recovery or a power blip). Whatever was in flight died with the
  // reboot, and the sorter is back on default calibration — fail the queue
  // fast, tell the user, and run the boot sequence again.
  useEffect(() => {
    const listener: SerialMessageListener = (msg) => {
      if (
        typeof msg !== "object" ||
        msg === null ||
        (msg as Record<string, unknown>).status !== "ready"
      ) {
        return;
      }
      const port = portRef.current;
      // The first banner of a connection is openPort's to handle.
      if (!port || !isReadyRef.current) return;
      isReadyRef.current = false;
      setIsReady(false);
      const cause = (msg as Record<string, unknown>).cause ?? "unknown";
      log.record({ eventType: "reboot_detected", payload: { cause } });
      queue.reset();
      console.warn("[Serial] Device rebooted mid-session, cause:", cause);
      toast.warning(t("serial.deviceRebooted.title"), {
        description: t("serial.deviceRebooted.description"),
      });
      void runBootSequence(port);
    };
    const listeners = listenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [queue, runBootSequence, t, log]);

  const subscribe = useCallback((listener: SerialMessageListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const registerPreTestHook = useCallback((fn: () => Promise<void>) => {
    preTestHooksRef.current.add(fn);
    return () => {
      preTestHooksRef.current.delete(fn);
    };
  }, []);

  const binBusyRef = useRef(false);

  const sendBin = useCallback(
    async (binNumber: number): Promise<unknown | null> => {
      if (!portRef.current || !writableRef.current) return null;
      if (binBusyRef.current) return null;

      binBusyRef.current = true;
      try {
        const { sent, response } = await request(
          JSON.stringify({ bin: binNumber }),
          15000,
        );
        if (!sent || !response) return null;

        try {
          return JSON.parse(response);
        } catch {
          console.warn("[Serial] Non-JSON response:", response);
          return null;
        }
      } finally {
        binBusyRef.current = false;
      }
    },
    [request],
  );

  return (
    <SerialContext
      value={{
        isConnected,
        isReady,
        connect,
        disconnect,
        sendBin,
        sendTest,
        request,
        requestLatest,
        subscribe,
        registerPreTestHook,
      }}
    >
      {children}
    </SerialContext>
  );
}

export function useSerial() {
  const context = useContext(SerialContext);
  if (!context) {
    throw new Error("useSerial must be used within a SerialProvider");
  }
  return context;
}

/**
 * Subscribe to all parsed JSON messages from the Arduino.
 * The callback is stable across re-renders (uses a ref internally).
 */
export function useSerialMessage(listener: SerialMessageListener) {
  const { subscribe } = useSerial();
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    return subscribe((msg) => listenerRef.current(msg));
  }, [subscribe]);
}
