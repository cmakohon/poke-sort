import { readFileSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HOST, PORT, STATIC_DIR } from "./config";
import { migrateDatabase } from "./db/migrate";
import { seedDatabase } from "./db/seed";
import type { AppEnv } from "./middleware/auth";
import { adminRouter } from "./routes/admin";
import { sortBinsRouter } from "./routes/bins";
import { cardRouter } from "./routes/card";
import { capturesRouter } from "./routes/captures";
import { collectionsRouter } from "./routes/collections";
import { feederRouter } from "./routes/feeder";
import { gamesRouter } from "./routes/games";
import { moduleConfigsRouter } from "./routes/module-configs";
import { notificationsRouter } from "./routes/notifications";
import { orgSettingsRouter } from "./routes/org-settings";

/**
 * Present only when Electron runs this file inside a `utilityProcess`; the
 * server is otherwise a plain Node process and knows nothing about Electron.
 */
const parentPort = (
  process as NodeJS.Process & {
    parentPort?: { postMessage(message: unknown): void };
  }
).parentPort;

const app = new Hono<AppEnv>();

// Only needed when the Vite dev server is a separate origin. In the packaged
// app the SPA is served from this same server, so there is no cross-origin
// request to permit — and no handler is registered.
if (!STATIC_DIR) {
  app.use(
    cors({
      origin: process.env.WEB_URL ?? "http://localhost:5173",
      allowMethods: ["GET", "POST", "PUT", "DELETE"],
      allowHeaders: ["Content-Type"],
    }),
  );
}

// Mounted under /api so the dev server and the packaged app expose the exact
// same paths. Vite used to strip the prefix, which meant the two environments
// disagreed about every URL.
app.route("/api/cards", cardRouter);
app.route("/api/captures", capturesRouter);
app.route("/api/bins", sortBinsRouter);
app.route("/api/collections", collectionsRouter);
app.route("/api/modules", moduleConfigsRouter);
app.route("/api/feeder", feederRouter);
app.route("/api/games", gamesRouter);
app.route("/api/notifications", notificationsRouter);
app.route("/api/org-settings", orgSettingsRouter);
app.route("/api/admin", adminRouter);

// An unmatched /api path must 404 as JSON. Without this the SPA fallback below
// answers it with index.html and a 200, so a client calling a route that does
// not exist gets HTML where it expected JSON and fails with a parse error
// ("Unexpected token '<'") that says nothing about the real problem.
//
// Registered after the real routers, so it only sees genuinely unmatched paths.
app.all("/api/*", (c) =>
  c.json({ success: false, message: `No such API route: ${c.req.path}` }, 404),
);

if (STATIC_DIR) {
  const indexHtml = readFileSync(path.join(STATIC_DIR, "index.html"), "utf-8");

  // `root` is resolved against process.cwd() by serveStatic, and the packaged
  // app's cwd is arbitrary — so pass an absolute path and let it stay absolute.
  // The previous path.relative() also broke outright on Windows whenever cwd
  // and the resources sat on different volumes, where it returns an absolute
  // path anyway.
  app.use("/*", serveStatic({ root: STATIC_DIR }));

  // History fallback. React Router's createBrowserRouter needs deep links like
  // /collections to resolve to index.html — which is also why the app is
  // served over http rather than file://, where no such fallback is possible.
  app.get("*", (c) => c.html(indexHtml));
}

// Migrate then seed, both hard prerequisites rather than best-effort: with no
// schema, or no `games` rows to give the bin rule engine its field definitions,
// nothing can be sorted — so a failure here should stop the boot rather than
// serve a broken app.
migrateDatabase()
  .then(seedDatabase)
  .then(() => {
    serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
      console.log(`[server] Running on http://${HOST}:${info.port}`);
      // The desktop shell asks for port 0 and learns the real one here.
      parentPort?.postMessage({ type: "listening", port: info.port });
    });
  })
  .catch((err) => {
    console.error("[server] Failed to prepare database:", err);
    process.exit(1);
  });
