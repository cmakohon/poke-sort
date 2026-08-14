import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { DATA_DIR, HOST, PORT, SHUTDOWN_TIMEOUT_MS, STATIC_DIR } from "./config";
import { client } from "./db";
import { migrateDatabase } from "./db/migrate";
import { seedDatabase } from "./db/seed";
import { pruneObservability } from "./lib/retention";
import type { AppEnv } from "./middleware/auth";
import { adminRouter } from "./routes/admin";
import { sortBinsRouter } from "./routes/bins";
import { calibrationRouter } from "./routes/calibration";
import { cardRouter } from "./routes/card";
import { capturesRouter } from "./routes/captures";
import { collectionsRouter } from "./routes/collections";
import { debugRouter } from "./routes/debug";
import { feederRouter } from "./routes/feeder";
import { gamesRouter } from "./routes/games";
import { machineEventsRouter } from "./routes/machine-events";
import { moduleConfigsRouter } from "./routes/module-configs";
import { notificationsRouter } from "./routes/notifications";
import { orgSettingsRouter } from "./routes/org-settings";
import { reviewRouter } from "./routes/review";

/**
 * Present only when Electron runs this file inside a `utilityProcess`; the
 * server is otherwise a plain Node process and knows nothing about Electron.
 */
const parentPort = (
  process as NodeJS.Process & {
    parentPort?: { postMessage(message: unknown): void };
  }
).parentPort;

const PORT_FILE = path.join(DATA_DIR, "server.port");

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
app.route("/api/calibration", calibrationRouter);
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
app.route("/api/machine-events", machineEventsRouter);
app.route("/api/review", reviewRouter);
app.route("/api/debug", debugRouter);

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

/**
 * Anything a route throws without catching lands here.
 *
 * Without it Hono answers an uncaught throw with a bare 500 and no body, so the
 * client sees an empty response and the cause exists only in a log nobody is
 * watching. Routes still catch their own expected failures; this is the floor.
 */
app.onError((err, c) => {
  console.error(`[server] Unhandled error on ${c.req.method} ${c.req.path}:`, err);
  return c.json({ success: false, message: "Internal server error." }, 500);
});

// Migrate then seed, both hard prerequisites rather than best-effort: with no
// schema, or no `games` rows to give the bin rule engine its field definitions,
// nothing can be sorted — so a failure here should stop the boot rather than
// serve a broken app.
migrateDatabase()
  .then(seedDatabase)
  .then(() => {
    const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
      console.log(`[server] Running on http://${HOST}:${info.port}`);
      // The desktop shell asks for port 0 and learns the real one here.
      parentPort?.postMessage({ type: "listening", port: info.port });
      // Housekeeping, not a prerequisite: a big prune (bulk deletes + capture
      // unlinks) must not stand between the shell and a listening server.
      void pruneObservability();
      // The port is dynamic in the packaged app; the file lets anything
      // outside the Electron process (a diagnosing assistant, curl) find the
      // API without asking the user to read it out of a log.
      try {
        writeFileSync(PORT_FILE, String(info.port));
      } catch (err) {
        console.warn("[server] Could not write server.port:", err);
      }
    });
    installShutdownHandlers(server);
  })
  .catch((err) => {
    console.error("[server] Failed to prepare database:", err);
    process.exit(1);
  });

/**
 * Closes the HTTP server and the database before exiting.
 *
 * PGlite is a real Postgres writing real files. Killed mid-write it depends on
 * crash recovery to come back, which is what produced the `mutex lock failed`
 * noise on shutdown — and recovery is not something to lean on every quit when
 * a clean close is a few lines. The desktop shell sends SIGTERM and waits for
 * this to finish.
 *
 * Bounded, because a hung close must not be worse than the abrupt kill it
 * replaced: if the graceful path overruns, exit anyway.
 */
function installShutdownHandlers(server: { close(cb?: (err?: Error) => void): void }): void {
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    // A second Ctrl-C should be an escape hatch, not a queued second teardown.
    if (shuttingDown) {
      console.warn(`[server] ${signal} during shutdown; exiting now.`);
      process.exit(1);
    }
    shuttingDown = true;
    console.log(`[server] ${signal} received, shutting down...`);

    const forceExit = setTimeout(() => {
      console.warn("[server] Shutdown timed out; exiting anyway.");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    // Do not let the timer alone hold the process open.
    forceExit.unref();

    try {
      // Best-effort: a stale port file only ever points a reader at a
      // connection-refused, which is self-explaining.
      rmSync(PORT_FILE, { force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await client.close();
      console.log("[server] Database closed cleanly.");
      clearTimeout(forceExit);
      process.exit(0);
    } catch (err) {
      console.error("[server] Error during shutdown:", err);
      clearTimeout(forceExit);
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
