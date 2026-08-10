import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
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

const app = new Hono<AppEnv>();
const PORT = parseInt(process.env.PORT ?? "3001");

// Still needed while the Vite dev server is a separate origin. Phase 3 serves
// the built SPA from this server, at which point this can go.
app.use(
  cors({
    origin: process.env.WEB_URL ?? "http://localhost:5173",
    allowMethods: ["GET", "POST", "PUT", "DELETE"],
    allowHeaders: ["Content-Type"],
  }),
);

app.route("/cards", cardRouter);
app.route("/captures", capturesRouter);
app.route("/bins", sortBinsRouter);
app.route("/collections", collectionsRouter);
app.route("/modules", moduleConfigsRouter);
app.route("/feeder", feederRouter);
app.route("/games", gamesRouter);
app.route("/notifications", notificationsRouter);
app.route("/org-settings", orgSettingsRouter);
app.route("/admin", adminRouter);

// Migrate then seed, both hard prerequisites rather than best-effort: with no
// schema, or no `games` rows to give the bin rule engine its field definitions,
// nothing can be sorted — so a failure here should stop the boot rather than
// serve a broken app.
migrateDatabase()
  .then(seedDatabase)
  .then(() => {
    serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, () => {
      console.log(`[server] Running on port:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("[server] Failed to prepare database:", err);
    process.exit(1);
  });
