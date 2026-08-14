import {
  DEFAULT_RETENTION,
  type RetentionSettings,
  resolveRetention,
  retentionCutoff,
} from "@poke-sort/shared";
import { and, eq, isNotNull, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "../db";
import {
  binSetAudit,
  feederConfigAudit,
  machineEvents,
  moduleConfigAudit,
  orgSettings,
  scanEvents,
} from "../db/schema";
import { deleteCaptures } from "./captures";

/**
 * Pruning for the observability tables — at boot, and on demand from the Data
 * usage screen.
 *
 * These tables exist to answer "what went wrong recently", not to be an
 * archive — and the diagnostics captures are the one part of scan_events that
 * costs real disk (~150 KB per scan against a few KB of row). So: serial
 * telemetry keeps two weeks, scan diagnostics keep six months, and accepted
 * scans lose their image (not their numbers) after a month. Rows a human
 * reviewed — confirmed-correct included, not just corrections — are exempt
 * from deletion entirely: they are labelled eval data, the most expensive
 * thing here to regenerate.
 *
 * Those thresholds are now settings rather than constants (see
 * DEFAULT_RETENTION), because a policy the user cannot see is a policy they
 * cannot trust. The exemption is not a setting and has no UI: a manual trim
 * runs the same functions the boot prune does, so "delete everything" still
 * cannot reach reviewed rows.
 *
 * The boot path is best-effort by design: the caller must treat a pruning
 * failure as a warning, never a boot failure.
 *
 * Nothing here filters by org. Retention describes this install's disk, not a
 * tenant's data, and machine_events carries no org_id at all — a predicate
 * that applied to three tables out of five would only suggest an isolation
 * that isn't there.
 */

/**
 * How far back a pass reaches. `"all"` means no lower bound.
 *
 * Deliberately not `null`: for a retention setting null-ish means "keep
 * forever" and for a manual trim it means the exact opposite, and one type
 * carrying both readings is how you delete a catalog.
 */
export type Cutoff = Date | "all";

export interface TrimResult {
  rowsDeleted: number;
  filesDeleted: number;
  /** Real bytes returned to the filesystem — capture unlinks only. */
  bytesFreedOnDisk: number;
  /** Reviewed or corrected rows this pass refused to touch. */
  rowsProtected: number;
}

const EMPTY: TrimResult = {
  rowsDeleted: 0,
  filesDeleted: 0,
  bytesFreedOnDisk: 0,
  rowsProtected: 0,
};

/** Reviewed or corrected: labelled eval data, never deleted by any pass. */
const isProtected = or(
  isNotNull(scanEvents.correctedCardId),
  isNotNull(scanEvents.reviewedAt),
);
const isNotProtected = and(
  isNull(scanEvents.correctedCardId),
  isNull(scanEvents.reviewedAt),
);

/** `undefined` from a `Date | "all"` cutoff means "no age predicate at all". */
function olderThan(column: AnyPgColumn, cutoff: Cutoff): SQL | undefined {
  return cutoff === "all" ? undefined : lt(column, cutoff);
}

async function countProtected(cutoff: Cutoff): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(scanEvents)
    .where(and(olderThan(scanEvents.createdAt, cutoff), isProtected));
  return row?.n ?? 0;
}

// ─── Individual passes ───────────────────────────────────────────────────────

/**
 * Counted before the delete rather than through RETURNING: this is the highest
 * insert-rate table in the system, and materialising a million ids to learn a
 * number the settings screen prints once is not a trade worth making. The
 * cutoff is a fixed instant, so a concurrent insert cannot land inside it and
 * make the count wrong.
 */
async function countOlderThan(column: AnyPgColumn, table: PgTable, cutoff: Cutoff): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(olderThan(column, cutoff));
  return row?.n ?? 0;
}

export async function pruneMachineEvents(cutoff: Cutoff): Promise<TrimResult> {
  const rowsDeleted = await countOlderThan(machineEvents.ts, machineEvents, cutoff);
  if (rowsDeleted === 0) return EMPTY;
  await db.delete(machineEvents).where(olderThan(machineEvents.ts, cutoff));
  return { ...EMPTY, rowsDeleted };
}

/** Deletes the row and its capture together; exempts reviewed/corrected rows. */
export async function pruneScanEvents(cutoff: Cutoff): Promise<TrimResult> {
  const rowsProtected = await countProtected(cutoff);
  const expired = await db
    .delete(scanEvents)
    .where(and(olderThan(scanEvents.createdAt, cutoff), isNotProtected))
    .returning({ capturePath: scanEvents.capturePath });
  const files = await deleteCaptures(expired.map((r) => r.capturePath));
  return {
    rowsDeleted: expired.length,
    filesDeleted: files.filesDeleted,
    bytesFreedOnDisk: files.bytesFreed,
    rowsProtected,
  };
}

/**
 * Drops capture images while keeping the rows.
 *
 * `acceptOnly` is the difference between the two callers. The boot policy
 * targets accepted scans, whose image nobody revisits; a manual "free up the
 * captures" reaches every tier, because the user asked for the disk back and
 * the numbers survive either way.
 */
async function pruneCaptures(
  cutoff: Cutoff,
  acceptOnly: boolean,
): Promise<TrimResult> {
  const rowsProtected = await countProtected(cutoff);
  // Two steps because RETURNING reflects the post-update row: read the file
  // names first, null the column, then unlink. An unlink failure leaves an
  // orphan file (wasted disk), never a row pointing at nothing.
  const where = and(
    acceptOnly ? eq(scanEvents.tier, "accept") : undefined,
    olderThan(scanEvents.createdAt, cutoff),
    isNotProtected,
    isNotNull(scanEvents.capturePath),
  );
  const targets = await db
    .select({ capturePath: scanEvents.capturePath })
    .from(scanEvents)
    .where(where);
  if (targets.length === 0) return { ...EMPTY, rowsProtected };

  await db.update(scanEvents).set({ capturePath: null }).where(where);
  const files = await deleteCaptures(targets.map((r) => r.capturePath));
  return {
    // No row was deleted — only its image. Reporting the count as rowsDeleted
    // would make the settings screen claim scans disappeared that did not.
    rowsDeleted: 0,
    filesDeleted: files.filesDeleted,
    bytesFreedOnDisk: files.bytesFreed,
    rowsProtected,
  };
}

/** Boot policy: accepted scans lose their image after acceptCaptureDays. */
export function pruneAcceptCaptures(cutoff: Cutoff): Promise<TrimResult> {
  return pruneCaptures(cutoff, true);
}

/** Manual trim: every tier's image, same exemption. */
export function pruneScanCaptures(cutoff: Cutoff): Promise<TrimResult> {
  return pruneCaptures(cutoff, false);
}

/**
 * The three config audit tables.
 *
 * These are the restore points behind the Restore actions on Calibrate and
 * Sorts (routes/bins.ts, module-configs.ts, feeder.ts). Deleting them does not
 * change the machine's current configuration — that lives in bin_sets / bins /
 * module_configs / feeder_configs — it removes the ability to roll back.
 */
export async function pruneConfigAudits(cutoff: Cutoff): Promise<TrimResult> {
  // Three separate statements rather than a loop over a tuple: the tables have
  // different column sets, and a union of them defeats drizzle's inference.
  let rowsDeleted = 0;
  rowsDeleted += await countOlderThan(binSetAudit.createdAt, binSetAudit, cutoff);
  rowsDeleted += await countOlderThan(moduleConfigAudit.createdAt, moduleConfigAudit, cutoff);
  rowsDeleted += await countOlderThan(feederConfigAudit.createdAt, feederConfigAudit, cutoff);
  if (rowsDeleted === 0) return EMPTY;

  await db.delete(binSetAudit).where(olderThan(binSetAudit.createdAt, cutoff));
  await db.delete(moduleConfigAudit).where(olderThan(moduleConfigAudit.createdAt, cutoff));
  await db.delete(feederConfigAudit).where(olderThan(feederConfigAudit.createdAt, cutoff));
  return { ...EMPTY, rowsDeleted };
}

// ─── Settings ────────────────────────────────────────────────────────────────

type OrgSettingsRow = typeof orgSettings.$inferSelect;

/**
 * Column names to policy keys, then through the shared resolver.
 *
 * The clamping lives in @poke-sort/shared rather than here so it can be tested
 * without importing this module — which opens PGlite on import, and a second
 * opener corrupts the WAL. This wrapper is the only DB-shaped part.
 */
export function retentionFromRow(row?: Partial<OrgSettingsRow>): RetentionSettings {
  return resolveRetention({
    machineEventDays: row?.retentionMachineEventDays,
    scanEventDays: row?.retentionScanEventDays,
    acceptCaptureDays: row?.retentionAcceptCaptureDays,
    configAuditDays: row?.retentionConfigAuditDays,
  });
}

/**
 * Its own try/catch, inside pruneObservability's: a column that does not exist
 * yet (an older build, a migration not applied) must cost the customised
 * thresholds and never the prune itself.
 */
export async function loadRetentionSettings(): Promise<RetentionSettings> {
  try {
    // No org predicate: the boot prune has no request context, and the table
    // holds exactly one row (unique on org_id) in this single-tenant build.
    const row = await db.query.orgSettings.findFirst();
    return retentionFromRow(row);
  } catch (err) {
    console.warn("[retention] could not read settings; using defaults:", err);
    return { ...DEFAULT_RETENTION };
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────

export async function pruneObservability(): Promise<void> {
  try {
    const settings = await loadRetentionSettings();
    const passes: [string, number, (c: Cutoff) => Promise<TrimResult>][] = [
      ["machineEvents", settings.machineEventDays, pruneMachineEvents],
      ["scanEvents", settings.scanEventDays, pruneScanEvents],
      ["acceptCaptures", settings.acceptCaptureDays, pruneAcceptCaptures],
      ["configAudits", settings.configAuditDays, pruneConfigAudits],
    ];
    for (const [name, days, run] of passes) {
      const cutoff = retentionCutoff(days);
      // null means keep forever, so the pass does not run at all rather than
      // issuing a DELETE that happens to match nothing.
      if (!cutoff) continue;
      const result = await run(cutoff);
      if (result.rowsDeleted > 0 || result.filesDeleted > 0) {
        console.log(
          `[retention] ${name}: ${result.rowsDeleted} rows, ${result.filesDeleted} files`,
        );
      }
    }
  } catch (err) {
    console.warn("[retention] pruning failed:", err);
  }
}
