/**
 * One machine/serial telemetry event, as the renderer reports it to
 * POST /api/machine-events. The renderer is the only place the serial port
 * exists, so it is the only writer; the server just persists batches.
 */
export interface MachineEventInput {
  /** uuid minted once per SerialProvider mount (one per app launch). */
  sessionId: string;
  /** uuid minted per successful port open; absent before a port is open. */
  connectionId?: string;
  /** Monotonic per-session counter — orders events that share a millisecond. */
  seq: number;
  /** Client event time, epoch milliseconds. */
  ts: number;
  eventType: MachineEventType;
  /** For exchange events: the command key sent ("bin", "servo", "test"...). */
  command?: string;
  outcome?: "ok" | "timeout" | "write_failed" | "reset";
  latencyMs?: number;
  payload?: Record<string, unknown>;
}

export type MachineEventType =
  /** One completed command/response round trip (any outcome). */
  | "exchange"
  /** The request queue failed everything in flight; happens on disconnect. */
  | "queue_reset"
  | "connect_failed"
  | "port_opened"
  | "port_open_failed"
  /** The ready banner arrived (or didn't — see payload.timedOut). */
  | "ready"
  | "boot_test_pass"
  | "boot_test_fail"
  /** A pre-test sync step threw instead of reporting a result. */
  | "boot_sync_failed"
  /** Calibration did not fully land, so the self-test was not run. */
  | "boot_test_skipped"
  /** Mid-session reset: calibration re-pushed, self-test deliberately skipped. */
  | "reboot_resync"
  /** A second ready banner mid-session: the MCU reset (watchdog, power blip). */
  | "reboot_detected"
  | "unplug"
  | "stream_ended"
  | "read_error"
  | "disconnect"
  /** A line the firmware sent on its own (jam alerts, stray banners). */
  | "rx_unsolicited"
  | "rx_non_json"
  /** The client-side buffer overflowed and dropped payload.dropped events. */
  | "log_overflow";
