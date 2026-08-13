import { MAX_POST_EVENTS } from "@/features/scanner/lib/machine-event-log";
import { API_BASE } from "@/lib/api/client";
import type { MachineEventInput } from "@poke-sort/shared";

/**
 * Delivery for the machine event log. Two paths: the normal batched POST
 * (keepalive, so a batch racing a window close still goes out), and a
 * sendBeacon for pagehide, when fetch promises are no longer guaranteed to
 * run. Both throw/no-op rather than report — the log's retry buffer owns
 * failure handling, and telemetry about telemetry is a feedback loop.
 */

export async function postMachineEvents(
  events: MachineEventInput[],
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/machine-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
    keepalive: true,
  });
  if (!res.ok) throw new Error(`machine-events post failed: ${res.status}`);
}

export function beaconMachineEvents(events: MachineEventInput[]): void {
  if (events.length === 0 || !navigator.sendBeacon) return;
  // Chunked for the same reason flush() chunks: sendBeacon shares the 64 KiB
  // in-flight quota, and one oversized blob would be refused whole. A false
  // return means the quota is exhausted — stop; this path is best-effort.
  for (let i = 0; i < events.length; i += MAX_POST_EVENTS) {
    const chunk = events.slice(i, i + MAX_POST_EVENTS);
    // text/plain keeps the beacon a "simple" request (no preflight, which a
    // closing page cannot answer); the server parses the body as JSON anyway.
    const accepted = navigator.sendBeacon(
      `${API_BASE}/api/machine-events`,
      new Blob([JSON.stringify({ events: chunk })], { type: "text/plain" }),
    );
    if (!accepted) return;
  }
}
