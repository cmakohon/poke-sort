import { Hono } from "hono";
import {
  CalibrationDocumentSchema,
  exportCalibration,
  importCalibration,
} from "../lib/calibration";
import { parseBody } from "../lib/validate";
import { requireAuth, requireOrg, type AppEnv } from "../middleware/auth";

const router = new Hono<AppEnv>();

// GET /calibration — the whole machine as one document.
router.get("/", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  try {
    return c.json({
      success: true,
      message: "Exported calibration.",
      data: await exportCalibration(orgId),
    });
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

// POST /calibration — apply a document produced by the GET above, or written
// by hand from another machine's calibration screen.
router.post("/", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const parsed = await parseBody(c, CalibrationDocumentSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const summary = await importCalibration(parsed.data, orgId);
    return c.json({
      success: true,
      message: `Imported ${summary.modules} module(s)${
        summary.feeder ? ", feeder" : ""
      }${summary.scanRegion ? ", scan region" : ""}.`,
      data: summary,
    });
  } catch (err) {
    console.error(err);
    return c.json({ success: false, message: "Database error." }, 500);
  }
});

export { router as calibrationRouter };
