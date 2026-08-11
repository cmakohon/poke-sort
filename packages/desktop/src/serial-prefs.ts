import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

/**
 * Which USB serial device to auto-select.
 *
 * Identified by what the device reports about itself, NOT by `portId`. Electron
 * regenerates portId on every launch — the same board enumerated as
 * 00E827879135B44F7E68D378101CC5FC on one run and 719888E9C81163DE4BD657F13156A993
 * on the next — so the previous version of this file stored a value that could
 * never match again. It was write-only.
 *
 * `serialNumber` is what actually pins one physical board: it survives replugging
 * and distinguishes two identical Arduinos. It is optional because plenty of
 * boards do not report one — CH340-based clones typically report none at all —
 * so matching falls back to vendor and product, which at least pins the model.
 */

export interface SerialPortIdentity {
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
}

const FILE = () => path.join(app.getPath("userData"), "serial-prefs.json");

export function loadPreferredPort(): SerialPortIdentity | null {
  try {
    const raw = JSON.parse(readFileSync(FILE(), "utf-8")) as {
      preferredPort?: SerialPortIdentity | null;
    };
    const p = raw.preferredPort;
    if (!p || (!p.vendorId && !p.productId && !p.serialNumber)) return null;
    return p;
  } catch {
    return null;
  }
}

export function savePreferredPort(identity: SerialPortIdentity | null): void {
  try {
    writeFileSync(FILE(), JSON.stringify({ preferredPort: identity }, null, 2));
  } catch (err) {
    console.error("[desktop] Could not persist serial port preference:", err);
  }
}

/**
 * How well a port matches a remembered device.
 *
 * 2 = the same physical board (serial number agreed), 1 = the same model,
 * 0 = not a match. Ranked rather than boolean so a serial-number match always
 * beats a same-model one when two like boards are attached.
 */
export function matchScore(
  port: { vendorId?: string; productId?: string; serialNumber?: string },
  pref: SerialPortIdentity,
): number {
  const sameModel =
    !!pref.vendorId &&
    !!pref.productId &&
    port.vendorId === pref.vendorId &&
    port.productId === pref.productId;
  if (!sameModel) return 0;
  if (pref.serialNumber) {
    return port.serialNumber === pref.serialNumber ? 2 : 0;
  }
  return 1;
}
