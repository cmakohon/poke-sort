/**
 * How long the app keeps the data it generates about itself.
 *
 * These used to be constants inside the server's retention module, which meant
 * data disappeared on a schedule the user could neither see nor change. They
 * live here now because three places have to agree on them: the boot-time
 * prune, the API schema that validates an edit, and the settings UI that shows
 * the current value. A default that drifts between those three is a screen
 * that lies about when your scans expire.
 */

export const DEFAULT_RETENTION = {
  /** Serial telemetry answers "what went wrong recently", not "last year". */
  machineEventDays: 14,
  /** Scan diagnostics are numbers, and cheap; the images are the expensive part. */
  scanEventDays: 180,
  /** An accepted scan's capture is ~150 KB and nobody looks at it after a month. */
  acceptCaptureDays: 30,
  /** Config history is the Restore buttons' backing store — kept forever by default. */
  configAuditDays: 0,
} as const;

export type RetentionSettings = {
  -readonly [K in keyof typeof DEFAULT_RETENTION]: number;
};

export type RetentionKey = keyof RetentionSettings;

export const RETENTION_KEYS = [
  "machineEventDays",
  "scanEventDays",
  "acceptCaptureDays",
  "configAuditDays",
] as const satisfies readonly RetentionKey[];

/** Ten years. Past this the setting is indistinguishable from "forever". */
export const RETENTION_MAX_DAYS = 3650;

/** Zero means keep forever — the prune skips the pass rather than picking an epoch. */
export const RETENTION_KEEP_FOREVER = 0;

/** Options the settings UI offers; `0` renders as "Forever". */
export const RETENTION_DAY_OPTIONS = [7, 14, 30, 90, 180, 365, RETENTION_KEEP_FOREVER] as const;

/**
 * The cutoff a prune pass should use, or null when the pass should not run.
 *
 * Returning null rather than `new Date(0)` is deliberate: an epoch cutoff still
 * issues a DELETE, and a delete that is only harmless because no row is old
 * enough is not the same thing as not deleting.
 */
export function retentionCutoff(days: number, now: number = Date.now()): Date | null {
  return days > RETENTION_KEEP_FOREVER ? new Date(now - days * 86_400_000) : null;
}

/**
 * Every stored value turned into a policy that is safe to act on.
 *
 * Total by construction: null, undefined, NaN, a float, a negative or a
 * century all resolve to the shipped default rather than throwing, because
 * both callers are places where throwing is worse than falling back — the boot
 * prune would abort, and the settings screen would render nothing. It lives
 * here, in the package with no database import, so it can be tested without
 * opening the data directory.
 */
export function resolveRetention(
  stored?: Partial<Record<RetentionKey, number | null | undefined>>,
): RetentionSettings {
  const resolved = {} as RetentionSettings;
  for (const key of RETENTION_KEYS) {
    const raw = stored?.[key];
    const fallback = DEFAULT_RETENTION[key];
    if (raw == null) {
      resolved[key] = fallback;
    } else if (
      !Number.isInteger(raw) ||
      raw < RETENTION_KEEP_FOREVER ||
      raw > RETENTION_MAX_DAYS
    ) {
      console.warn(`[retention] Ignoring ${key}=${raw}; using ${fallback}.`);
      resolved[key] = fallback;
    } else {
      resolved[key] = raw;
    }
  }
  return resolved;
}
