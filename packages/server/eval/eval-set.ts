import path from "node:path";
import { fileURLToPath } from "node:url";

// Which fixture set capture-signals / tune / ocr-sweep run against, so the
// synthetic renders ("pokemon") and the labelled real captures
// ("pokemon-real") coexist without overwriting each other's signal dumps:
//
//   EVAL_FIXTURES=pokemon-real pnpm eval:capture
//
// The default set keeps its historical un-suffixed signals.json name.
const here = path.dirname(fileURLToPath(import.meta.url));

export const EVAL_SET = process.env.EVAL_FIXTURES ?? "pokemon";
export const FIXTURES_DIR = path.join(here, "fixtures", EVAL_SET);
export const SIGNALS_PATH = path.join(
  here,
  EVAL_SET === "pokemon" ? "signals.json" : `signals-${EVAL_SET}.json`,
);
