import {
  LOCAL_ORG_ID,
  SCAN_COVERAGE_MAX,
  SCAN_COVERAGE_MIN,
  SCAN_OFFSET_LIMIT,
  SCAN_ROTATION_LIMIT,
  SERVO_PULSE_MAX,
  SERVO_PULSE_MIN,
} from "@poke-sort/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  feederConfigAudit,
  feederConfigs,
  moduleConfigAudit,
  moduleConfigs,
  orgSettings,
} from "../db/schema";
import { ScanCornersSchema, parseScanCorners } from "./scan-corners";

/**
 * Calibration as a portable document.
 *
 * Calibration is the one thing in this app that cannot be recomputed: it
 * describes a specific physical machine — where its servos sit, how hard its
 * feeder pushes, where its camera happens to be pointing. Everything else
 * (catalog, embeddings, even collections) can be rebuilt from upstream or by
 * rescanning. This cannot, short of doing it again by hand.
 *
 * So it gets a file format: the numbers that survive a reinstall, a machine
 * move, or an experiment gone wrong.
 *
 * The shape deliberately mirrors the UI rather than the tables — pulse counts
 * per named servo, scan region as fractions and whole degrees — so a human
 * filling one in from another machine's calibration screen can see which field
 * is which. The integer storage of the scan region (hundredths of a frame,
 * tenths of a degree) is a database detail and stays there.
 */

const servoPulse = z.number().int().min(SERVO_PULSE_MIN).max(SERVO_PULSE_MAX);
// Ten minutes. The calibration UI clamps these only at the bottom, so any
// ceiling here is the API inventing a limit the screen does not have — this one
// is set where no plausible feed timing reaches it, rather than at a guess.
const durationMs = z.number().int().min(0).max(600_000);
/** A fraction of the frame, as the calibration UI expresses it. */
const coverage = z.number().min(SCAN_COVERAGE_MIN).max(SCAN_COVERAGE_MAX);
/** Signed: the capture window moves either way from the centre of the frame. */
const offset = z.number().min(-SCAN_OFFSET_LIMIT).max(SCAN_OFFSET_LIMIT);
/** Signed degrees, clockwise, correcting a camera mounted off square. */
const rotation = z.number().min(-SCAN_ROTATION_LIMIT).max(SCAN_ROTATION_LIMIT);

/**
 * Still version 1 after gaining `scanRegion.rotation` and then `scanCorners`.
 *
 * They are optional, so every file written before they existed still imports —
 * and bumping the version would have broken exactly those files, since the
 * field is a literal, not a range. The cost is that a file written here fails
 * `.strict()` on an older build; the alternative was orphaning the calibration
 * files that already exist, which is the worse half of the trade.
 */
export const CALIBRATION_FORMAT_VERSION = 1;

export const CalibrationDocumentSchema = z
  .object({
    version: z.literal(CALIBRATION_FORMAT_VERSION),
    exportedAt: z.string().optional(),
    /** Free text, so a file can say which machine it came from. */
    note: z.string().max(500).optional(),
    modules: z
      .array(
        z
          .object({
            moduleNumber: z.union([z.literal(1), z.literal(2), z.literal(3)]),
            bottomClosed: servoPulse,
            bottomOpen: servoPulse,
            paddleClosed: servoPulse,
            paddleOpen: servoPulse,
            pusherLeft: servoPulse,
            pusherNeutral: servoPulse,
            pusherRight: servoPulse,
          })
          .strict(),
      )
      .max(3),
    feeder: z
      .object({
        speed: servoPulse,
        duration: durationMs,
        pulseDuration: durationMs,
        pauseDuration: durationMs,
        settleDuration: durationMs,
      })
      .strict()
      .optional(),
    scanRegion: z
      .object({
        coverage,
        offsetX: offset,
        offsetY: offset,
        rotation: rotation.optional(),
      })
      .strict()
      .nullable()
      .optional(),
    /**
     * The four-corner region that supersedes scanRegion above. Both are
     * carried: a file exported here still applies on a build that only knows
     * the rectangle, and the rectangle is still what an install falls back to
     * when no corners are stored.
     */
    scanCorners: ScanCornersSchema.nullable().optional(),
    /** ms between the IR sensor confirming a card and the frame capture. */
    captureSettleDelayMs: z.number().int().min(0).max(5000).nullable().optional(),
  })
  .strict();

export type CalibrationDocument = z.infer<typeof CalibrationDocumentSchema>;

/**
 * Existing rows can hold values the firmware would never honour — the original
 * column defaults included 102, below the 120 floor. Exporting them verbatim
 * produced a file that could not be imported back, so a document would fail to
 * describe the very machine it came from.
 *
 * Clamping is not a silent edit: the firmware already clamps identically on
 * every write, so 102 was only ever driven as 120. The clamped file is the
 * accurate description of what the hardware does; the stored number was the
 * fiction. Callers are told what changed.
 */
function clampPulse(value: number, clamped: string[], field: string): number {
  const next = Math.min(SERVO_PULSE_MAX, Math.max(SERVO_PULSE_MIN, value));
  if (next !== value) clamped.push(`${field}: ${value} -> ${next}`);
  return next;
}

export interface ExportResult {
  document: CalibrationDocument;
  /** Values outside the firmware range, as "field: before -> after". */
  clamped: string[];
}

export async function exportCalibrationWithReport(
  orgId: string = LOCAL_ORG_ID,
): Promise<ExportResult> {
  const clamped: string[] = [];
  const document = await buildDocument(orgId, clamped);
  return { document, clamped };
}

export async function exportCalibration(
  orgId: string = LOCAL_ORG_ID,
): Promise<CalibrationDocument> {
  return buildDocument(orgId, []);
}

async function buildDocument(
  orgId: string,
  clamped: string[],
): Promise<CalibrationDocument> {
  const [modules, feeder, settings] = await Promise.all([
    db.query.moduleConfigs.findMany({
      where: (t, { eq: is }) => is(t.orgId, orgId),
      orderBy: (t, { asc }) => [asc(t.moduleNumber)],
    }),
    db.query.feederConfigs.findFirst({
      where: (t, { eq: is }) => is(t.orgId, orgId),
    }),
    db.query.orgSettings.findFirst({
      where: (t, { eq: is }) => is(t.orgId, orgId),
    }),
  ]);

  return {
    version: CALIBRATION_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    modules: modules.map((m) => ({
      moduleNumber: m.moduleNumber as 1 | 2 | 3,
      bottomClosed: clampPulse(m.bottomClosed, clamped, `module ${m.moduleNumber} bottomClosed`),
      bottomOpen: clampPulse(m.bottomOpen, clamped, `module ${m.moduleNumber} bottomOpen`),
      paddleClosed: clampPulse(m.paddleClosed, clamped, `module ${m.moduleNumber} paddleClosed`),
      paddleOpen: clampPulse(m.paddleOpen, clamped, `module ${m.moduleNumber} paddleOpen`),
      pusherLeft: clampPulse(m.pusherLeft, clamped, `module ${m.moduleNumber} pusherLeft`),
      pusherNeutral: clampPulse(m.pusherNeutral, clamped, `module ${m.moduleNumber} pusherNeutral`),
      pusherRight: clampPulse(m.pusherRight, clamped, `module ${m.moduleNumber} pusherRight`),
    })),
    ...(feeder
      ? {
          feeder: {
            speed: clampPulse(feeder.speed, clamped, "feeder speed"),
            duration: feeder.duration,
            pulseDuration: feeder.pulseDuration,
            pauseDuration: feeder.pauseDuration,
            settleDuration: feeder.settleDuration,
          },
        }
      : {}),
    scanRegion:
      settings?.scanCoverage != null &&
      settings.scanOffsetX != null &&
      settings.scanOffsetY != null
        ? {
            coverage: settings.scanCoverage / 100,
            offsetX: settings.scanOffsetX / 100,
            offsetY: settings.scanOffsetY / 100,
            rotation: (settings.scanRotation ?? 0) / 10,
          }
        : null,
    scanCorners: parseScanCorners(settings?.scanCorners),
    ...(settings?.captureSettleDelayMs != null
      ? { captureSettleDelayMs: settings.captureSettleDelayMs }
      : {}),
  };
}

export interface ImportSummary {
  modules: number;
  feeder: boolean;
  scanRegion: boolean;
}

/**
 * Applies a document, in one transaction.
 *
 * Partial application is the failure mode worth avoiding: half-written servo
 * positions describe a machine that does not exist, and the sorter would drive
 * to them without complaint. Sections absent from the document are left alone
 * rather than reset, so a file carrying only servo positions does not silently
 * wipe the scan region.
 *
 * Every write also lands in the audit tables, so an import can be reverted from
 * the calibration history exactly like a manual change.
 */
export async function importCalibration(
  doc: CalibrationDocument,
  orgId: string = LOCAL_ORG_ID,
): Promise<ImportSummary> {
  return db.transaction(async (tx) => {
    for (const m of doc.modules) {
      const { moduleNumber, ...calibration } = m;
      await tx
        .insert(moduleConfigs)
        .values({ ...calibration, moduleNumber, orgId })
        .onConflictDoUpdate({
          target: [moduleConfigs.orgId, moduleConfigs.moduleNumber],
          set: { ...calibration, updatedAt: new Date() },
        });
      await tx
        .insert(moduleConfigAudit)
        .values({ ...calibration, moduleNumber, orgId });
    }

    if (doc.feeder) {
      await tx
        .insert(feederConfigs)
        .values({ ...doc.feeder, orgId })
        .onConflictDoUpdate({
          target: [feederConfigs.orgId],
          set: { ...doc.feeder, updatedAt: new Date() },
        });
      await tx.insert(feederConfigAudit).values({ ...doc.feeder, orgId });
    }

    if (doc.captureSettleDelayMs !== undefined) {
      const existing = await tx.query.orgSettings.findFirst({
        where: eq(orgSettings.orgId, orgId),
      });
      if (existing) {
        await tx
          .update(orgSettings)
          .set({ captureSettleDelayMs: doc.captureSettleDelayMs, updatedAt: new Date() })
          .where(eq(orgSettings.orgId, orgId));
      } else {
        await tx
          .insert(orgSettings)
          .values({ captureSettleDelayMs: doc.captureSettleDelayMs, orgId });
      }
    }

    if (doc.scanRegion !== undefined || doc.scanCorners !== undefined) {
      const region =
        doc.scanRegion !== undefined
          ? doc.scanRegion
            ? {
                scanCoverage: Math.round(doc.scanRegion.coverage * 100),
                scanOffsetX: Math.round(doc.scanRegion.offsetX * 100),
                scanOffsetY: Math.round(doc.scanRegion.offsetY * 100),
                // A file predating rotation describes a square box, so absent
                // means zero here — unlike a PUT, where absent means
                // "unchanged". The document is the whole region, not a patch.
                scanRotation: Math.round((doc.scanRegion.rotation ?? 0) * 10),
              }
            : {
                scanCoverage: null,
                scanOffsetX: null,
                scanOffsetY: null,
                scanRotation: null,
              }
          : {};

      // Absent corners clear the stored quad rather than leaving it, for the
      // same reason absent rotation means zero above: a document describes a
      // whole scan region. Importing a file exported before corners existed
      // must land the rectangle that file describes, not that rectangle with
      // this machine's leftover quad still overriding it.
      const values = { ...region, scanCorners: doc.scanCorners ?? null };
      const existing = await tx.query.orgSettings.findFirst({
        where: eq(orgSettings.orgId, orgId),
      });
      if (existing) {
        await tx
          .update(orgSettings)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(orgSettings.orgId, orgId));
      } else {
        await tx.insert(orgSettings).values({ ...values, orgId });
      }
    }

    return {
      modules: doc.modules.length,
      feeder: !!doc.feeder,
      scanRegion: doc.scanRegion !== undefined || doc.scanCorners !== undefined,
    };
  });
}
