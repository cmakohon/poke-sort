import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

/**
 * Which USB serial device to auto-select.
 *
 * `select-serial-port` has to answer synchronously with a single port id, so
 * the choice cannot be prompted for at that moment. On a dedicated sorter
 * machine the first port is almost always right; this exists for the case
 * where it is not, and other USB serial devices are attached.
 */

const FILE = () => path.join(app.getPath("userData"), "serial-prefs.json");

export function loadPreferredPortId(): string | null {
  try {
    const raw = JSON.parse(readFileSync(FILE(), "utf-8")) as {
      preferredPortId?: string | null;
    };
    return raw.preferredPortId ?? null;
  } catch {
    return null;
  }
}

export function savePreferredPortId(portId: string | null): void {
  try {
    writeFileSync(FILE(), JSON.stringify({ preferredPortId: portId }, null, 2));
  } catch (err) {
    console.error("[desktop] Could not persist serial port preference:", err);
  }
}
