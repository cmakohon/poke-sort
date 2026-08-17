import { API_BASE, apiGet } from "@/lib/api/client";
import type {
  FeederCalibration,
  Result,
  ScanCorners,
  ScanRegion,
  ServoCalibration,
} from "@poke-sort/shared";

/**
 * The whole machine as one portable file — the same document the
 * `pnpm calibration` CLI reads and writes.
 *
 * This is a type, not a schema: the server owns validation
 * (`CalibrationDocumentSchema` in packages/server/src/lib/calibration.ts), and
 * a second copy here would be a second definition of the file format to keep
 * in step. What the UI needs is the shape it reads to describe a file before
 * applying it.
 */
export interface CalibrationDocument {
  version: number;
  exportedAt?: string;
  /** Free text, so a file can say which machine it came from. */
  note?: string;
  modules: (ServoCalibration & { moduleNumber: 1 | 2 | 3 })[];
  feeder?: FeederCalibration;
  /** Absent leaves the region alone; null clears it. `rotation` predates v1's last field. */
  scanRegion?: (Omit<ScanRegion, "rotation"> & { rotation?: number }) | null;
  /** The four-corner region. Absent in files written before it existed. */
  scanCorners?: ScanCorners | null;
  captureSettleDelayMs?: number | null;
}

export interface ImportSummary {
  modules: number;
  feeder: boolean;
  scanRegion: boolean;
}

export async function getCalibrationDocument(): Promise<CalibrationDocument> {
  const result = await apiGet<Result<CalibrationDocument>>("/api/calibration");
  if (!result.data) throw new Error(result.message);
  return result.data;
}

/**
 * Posts a file, and reports what the server said about it.
 *
 * Not `apiPost`: that throws `API error: 400` and drops the body, and the body
 * is the useful half. A rejected import answers with the offending field
 * ("modules.0.bottomClosed: ..."), which is the difference between a person
 * fixing their file and guessing at it.
 */
export async function importCalibrationDocument(
  doc: unknown,
): Promise<Result<ImportSummary>> {
  const res = await fetch(`${API_BASE}/api/calibration`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
  return res.json();
}
