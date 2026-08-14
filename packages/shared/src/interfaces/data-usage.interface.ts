/**
 * What the settings screen shows about disk, and what a trim did.
 *
 * The one rule this shape enforces: a byte number is only ever reported when it
 * was measured. Deleting rows in Postgres does not shrink the data directory —
 * plain VACUUM returns the space to the free-space map, not the OS — so a trim
 * reports real freed bytes for the files it unlinked and nothing at all for the
 * rows it deleted. The dead space rows leave behind is reported separately, as
 * `reusableBytes`, and is never presented as free disk.
 */

export type DataUsageCategoryKey =
  | "catalog"
  | "collection"
  | "scanCaptures"
  | "scanDiagnostics"
  | "machineTelemetry"
  | "configHistory"
  | "databaseOverhead"
  | "otherFiles";

/** The categories a user may delete from the settings screen. */
export type TrimmableCategoryKey = Extract<
  DataUsageCategoryKey,
  "scanCaptures" | "scanDiagnostics" | "machineTelemetry" | "configHistory"
>;

export const TRIMMABLE_CATEGORY_KEYS = [
  "scanCaptures",
  "scanDiagnostics",
  "machineTelemetry",
  "configHistory",
] as const satisfies readonly TrimmableCategoryKey[];

export type DataUsageCountUnit =
  | "cards"
  | "images"
  | "scans"
  | "events"
  | "snapshots"
  | "files";

export type TrimAge = "1w" | "1m" | "3m" | "all";

export const TRIM_AGES = ["1w", "1m", "3m", "all"] as const satisfies readonly TrimAge[];

/** Days each age option looks back. `all` has no lower bound, hence null. */
export const TRIM_AGE_DAYS: Record<TrimAge, number | null> = {
  "1w": 7,
  "1m": 30,
  "3m": 90,
  all: null,
};

export interface DataUsageCategory {
  key: DataUsageCategoryKey;
  bytes: number;
  count: number | null;
  countUnit: DataUsageCountUnit | null;
  /**
   * Dead-tuple space the database will reuse for new rows. Null for
   * file-backed categories, and null when the stats view is unavailable —
   * never zero as a stand-in, because zero is a claim and null is an absence.
   */
  reusableBytes: number | null;
  trimmable: boolean;
  /** Rows every trim refuses to delete: reviewed or corrected scans. */
  protectedCount?: number;
  /** How many rows/files each age option would delete, protected excluded. */
  trimPreview?: Record<TrimAge, number>;
}

export interface DataUsageSnapshot {
  /** Everything under DATA_DIR, as allocated blocks — what `du` reports. */
  totalBytes: number;
  /** Sums to exactly totalBytes; the two residual categories guarantee it. */
  categories: DataUsageCategory[];
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  /** The recognition model, outside DATA_DIR. Fixed size, not deletable. */
  modelBytes: number | null;
  computedAt: string;
  computeMs: number;
  /** Measurements that failed, named so a partial snapshot is legible. */
  warnings: string[];
}

export interface TrimRequest {
  category: TrimmableCategoryKey;
  olderThan: TrimAge;
}

export interface TrimOutcome {
  category: TrimmableCategoryKey;
  rowsDeleted: number;
  filesDeleted: number;
  /** Real bytes returned to the filesystem — capture unlinks only. */
  bytesFreedOnDisk: number;
  /** Reviewed or corrected rows the trim deliberately kept. */
  rowsProtected: number;
}
