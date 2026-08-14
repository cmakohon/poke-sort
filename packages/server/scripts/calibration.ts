/**
 * Calibration export / import / template.
 *
 * Talks to the database directly rather than over HTTP, because the packaged
 * app binds an ephemeral port there is no way to guess from a shell. That means
 * PGlite's single-connection rule applies: **quit the app first**, or this will
 * fail to open the data directory.
 *
 * Usage (from packages/server):
 *
 *   POKE_SORT_DATA_DIR=... pnpm calibration export   ./calibration.json
 *   POKE_SORT_DATA_DIR=... pnpm calibration template ./calibration.json
 *   POKE_SORT_DATA_DIR=... pnpm calibration import   ./calibration.json
 *
 * `template` writes the current values with every field present, which is the
 * one to use when copying numbers off another machine's calibration screen:
 * overwrite the values, leave the structure alone.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../src/config";
import { client } from "../src/db";
import {
  CalibrationDocumentSchema,
  CALIBRATION_FORMAT_VERSION,
  exportCalibrationWithReport,
  importCalibration,
  type CalibrationDocument,
} from "../src/lib/calibration";

const USAGE = `Usage: calibration <export|import|template> <file.json>

  export    write this machine's current calibration to a file
  template  same, but always emits every field — fill it in from another machine
  import    apply a file to this machine

The app must be closed: PGlite allows one process per data directory.
Set POKE_SORT_DATA_DIR to target a specific install, e.g.
  "$HOME/Library/Application Support/PokeSort"`;

/** Shown in `template` so a hand-filled file says what each number means. */
const FIELD_NOTES = {
  _README: [
    "Servo values are PCA9685 pulse counts (120-490), not degrees.",
    "scanRegion coverage/offsets are fractions of the frame (0-1);",
    "scanRegion rotation is degrees, clockwise, about the region's centre.",
    "Durations are milliseconds.",
    "Delete a section to leave it untouched on import.",
  ],
} as const;

async function main(): Promise<void> {
  const [command, file] = process.argv.slice(2);
  if (!command || !file) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const target = path.resolve(file);
  console.log(`[calibration] data dir: ${DATA_DIR}`);

  if (command === "export" || command === "template") {
    const { document: doc, clamped } = await exportCalibrationWithReport();
    for (const change of clamped) {
      console.warn(`[calibration] clamped to the firmware range — ${change}`);
    }
    if (doc.modules.length === 0) {
      console.warn(
        "[calibration] No module rows found — is POKE_SORT_DATA_DIR pointing at the right install?",
      );
    }
    const payload =
      command === "template" ? { ...FIELD_NOTES, ...doc } : doc;
    writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(
      `[calibration] wrote ${doc.modules.length} module(s)${doc.feeder ? ", feeder" : ""}${doc.scanRegion ? ", scan region" : ""} -> ${target}`,
    );
    return;
  }

  if (command === "import") {
    const raw: unknown = JSON.parse(readFileSync(target, "utf-8"));
    // Strip the comment block `template` adds, so a filled-in template imports
    // without the user having to delete anything first.
    if (raw && typeof raw === "object") {
      delete (raw as Record<string, unknown>)._README;
    }

    const parsed = CalibrationDocumentSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("[calibration] File is not valid:");
      for (const issue of parsed.error.issues) {
        console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      }
      if ((raw as { version?: unknown })?.version !== CALIBRATION_FORMAT_VERSION) {
        console.error(
          `  hint: expected "version": ${CALIBRATION_FORMAT_VERSION}`,
        );
      }
      process.exitCode = 1;
      return;
    }

    const summary = await importCalibration(parsed.data as CalibrationDocument);
    console.log(
      `[calibration] imported ${summary.modules} module(s)${summary.feeder ? ", feeder" : ""}${summary.scanRegion ? ", scan region" : ""}`,
    );
    return;
  }

  console.error(USAGE);
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("[calibration] Failed:", err);
    process.exitCode = 1;
  })
  // Close explicitly: PGlite holds the data directory until it does, and a
  // script that exits without closing leaves the next run to crash-recover.
  .finally(() => client.close());
