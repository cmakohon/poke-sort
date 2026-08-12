import { reportSerialEvent } from "@/features/notifications/api/notification-settings";
import {
  createSerialRequestQueue,
  isUnsolicitedLine,
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

export function SerialProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("scanner");
  const [isConnected, setIsConnected] = useState(false);
  const [isReady, setIsReady] = useState(false);
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
    queueRef.current = createSerialRequestQueue(writeRaw);
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
              }

              // Unsolicited traffic (jam alerts, the boot banner) goes to
              // subscribers only — handing it to a request waiter is what used
              // to shift every later exchange onto the wrong reply.
              if (!isUnsolicitedLine(trimmed)) {
                queue.handleLine(trimmed);
              }
            }
          }
        }
      } catch (e) {
        // Reader was cancelled (disconnect) - expected
        if (!(e instanceof DOMException && e.name === "NetworkError")) {
          console.error("[Serial] Read error:", e);
        }
      } finally {
        onEnd?.();
      }
    },
    [queue],
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

  const disconnect = useCallback(() => {
    const port = portRef.current;
    const reader = readerRef.current;

    // Clear refs and state immediately
    portRef.current = null;
    readerRef.current = null;
    writableRef.current = null;
    writeQueueRef.current = Promise.resolve();
    setIsConnected(false);
    setIsReady(false);

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
  }, [queue]);

  // Resolves once the firmware's {"status":"ready"} banner arrives (the
  // Arduino resets when the port opens), or after timeoutMs. The banner is
  // unsolicited, so it only ever reaches subscribers — this cannot consume a
  // command reply by accident.
  const waitForReady = useCallback((timeoutMs: number): Promise<void> => {
    return new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        listenersRef.current.delete(listener);
        resolve();
      };
      const listener: SerialMessageListener = (msg) => {
        if (
          typeof msg === "object" &&
          msg !== null &&
          (msg as Record<string, unknown>).status === "ready"
        ) {
          finish();
        }
      };
      const timer = setTimeout(finish, timeoutMs);
      listenersRef.current.add(listener);
    });
  }, []);

  const openPort = useCallback(
    async (port: SerialPort): Promise<boolean> => {
      if (!port.readable || !port.writable) {
        try {
          await port.open({ baudRate: 9600 });
        } catch {
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

      setIsConnected(true);

      startReading(reader, () => {
        if (portRef.current === port) {
          console.warn("[Serial] Stream ended unexpectedly, disconnecting");
          disconnect();
        }
      });

      (async () => {
        // Wait out the Arduino's boot before pushing config at it
        await waitForReady(5000);
        if (!portRef.current) return;
        for (const hook of [...preTestHooksRef.current]) {
          await hook();
          if (!portRef.current) return;
        }
        toast.info(t("serial.testingDevice"));
        const ok = await sendTest();
        if (!portRef.current) return;
        if (ok) {
          toast.success(t("serial.deviceReady"));
        } else {
          toast.error(t("serial.deviceTestFailed.title"), {
            description: t("serial.deviceTestFailed.description"),
          });
          void reportSerialEvent({
            command: "test",
            sent: true,
            response: null,
          });
        }
      })();

      return true;
    },
    [startReading, waitForReady, sendTest, disconnect, t],
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
        toast.error(t("serial.noDeviceFound.title"), {
          description: t("serial.noDeviceFound.description"),
        });
        return;
      }
      console.error("[Serial] requestPort failed:", err);
      toast.error(t("serial.connectionFailed.title"), {
        description: t("serial.connectionFailed.description"),
      });
      return;
    }

    await openPort(port);
  }, [openPort, t]);

  // Detect physical USB unplug
  useEffect(() => {
    if (!navigator.serial) return;
    const handleDisconnect = (event: Event) => {
      if (portRef.current && portRef.current === (event.target as SerialPort)) {
        console.warn("[Serial] Device unplugged");
        disconnect();
      }
    };
    navigator.serial.addEventListener("disconnect", handleDisconnect);
    return () => {
      navigator.serial.removeEventListener("disconnect", handleDisconnect);
    };
  }, [disconnect]);

  useEffect(() => {
    const listener: SerialMessageListener = (msg) => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        "status" in msg &&
        (msg as Record<string, unknown>).status === "test_complete"
      ) {
        setIsReady(true);
      }
    };
    const listeners = listenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

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
