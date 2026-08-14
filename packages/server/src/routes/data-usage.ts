import {
  TRIM_AGE_DAYS,
  TRIMMABLE_CATEGORY_KEYS,
  type TrimAge,
  type TrimmableCategoryKey,
  type TrimOutcome,
} from "@poke-sort/shared";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { getDataUsage, invalidateDataUsage } from "../lib/data-usage";
import {
  type Cutoff,
  pruneConfigAudits,
  pruneMachineEvents,
  pruneScanCaptures,
  pruneScanEvents,
  type TrimResult,
} from "../lib/retention";
import { parseBody } from "../lib/validate";
import { type AppEnv, requireAuth, requireOrg, requireRole } from "../middleware/auth";

const router = new Hono<AppEnv>();

router.get("/", requireAuth, requireOrg, async (c) => {
  try {
    const snapshot = await getDataUsage({ refresh: c.req.query("refresh") === "1" });
    // Never cached by anything in front of us: the whole point is a number the
    // user can trust the instant they look at it.
    c.header("Cache-Control", "no-store");
    return c.json({ success: true, message: "Measured.", data: snapshot });
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Could not measure data usage." }, 500);
  }
});

const TrimSchema = z
  .object({
    category: z.enum(TRIMMABLE_CATEGORY_KEYS),
    olderThan: z.enum(["1w", "1m", "3m", "all"]),
  })
  .strict();

function cutoffFor(age: TrimAge): Cutoff {
  const days = TRIM_AGE_DAYS[age];
  return days === null ? "all" : new Date(Date.now() - days * 86_400_000);
}

const RUNNERS: Record<TrimmableCategoryKey, (cutoff: Cutoff) => Promise<TrimResult>> = {
  scanCaptures: pruneScanCaptures,
  scanDiagnostics: pruneScanEvents,
  machineTelemetry: pruneMachineEvents,
  configHistory: pruneConfigAudits,
};

/** Which table to settle after the delete. Captures touch no rows. */
const VACUUM_TARGETS: Record<TrimmableCategoryKey, string[]> = {
  scanCaptures: [],
  scanDiagnostics: ["scan_events"],
  machineTelemetry: ["machine_events"],
  configHistory: ["bin_set_audit", "module_config_audit", "feeder_config_audit"],
};

/**
 * Plain VACUUM, never FULL.
 *
 * FULL rewrites the table: it needs twice the space and blocks this
 * single-threaded engine for as long as it takes, which on the machine's own
 * process means sorting stops. Plain VACUUM returns the dead space to the
 * free-space map so the next hundred thousand rows reuse it instead of
 * extending the file, and the ANALYZE refreshes n_dead_tup so the very next
 * snapshot reports the truth rather than the pre-delete estimate.
 *
 * Best-effort: a vacuum that fails leaves bloat, not damage.
 */
async function settle(category: TrimmableCategoryKey): Promise<void> {
  for (const table of VACUUM_TARGETS[category]) {
    try {
      // Table names come from the constant above, never from the request.
      await db.execute(sql.raw(`VACUUM (ANALYZE) ${table}`));
    } catch (err) {
      console.warn(`[data-usage] vacuum of ${table} failed:`, err);
    }
  }
}

/**
 * One trim at a time. Two overlapping bulk deletes on a single-threaded engine
 * do not finish any sooner, and the second one's preview is stale the moment
 * the first commits.
 */
let trimming = false;

router.post("/trim", requireAuth, requireOrg, requireRole("admin"), async (c) => {
  const parsed = await parseBody(c, TrimSchema);
  if (!parsed.ok) return parsed.response;
  const { category, olderThan } = parsed.data;

  if (trimming) {
    return c.json({ success: false, message: "A cleanup is already running." }, 409);
  }
  trimming = true;
  try {
    const result = await RUNNERS[category](cutoffFor(olderThan));
    await settle(category);
    // Before the response, so the refetch the client fires on success cannot
    // race the cache and show the numbers from before the delete.
    invalidateDataUsage();
    const outcome: TrimOutcome = { category, ...result };
    console.log(
      `[data-usage] trim ${category} ${olderThan}: ${result.rowsDeleted} rows, ` +
        `${result.filesDeleted} files, ${result.bytesFreedOnDisk} bytes`,
    );
    return c.json({ success: true, message: "Deleted.", data: outcome });
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Could not delete that data." }, 500);
  } finally {
    trimming = false;
  }
});

export { router as dataUsageRouter };
