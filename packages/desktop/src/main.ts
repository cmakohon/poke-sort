import fs from "node:fs";
import path from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import { loadPreferredPortId, savePreferredPortId } from "./serial-prefs";

/**
 * Dev mode points the window at the Vite dev server (HMR) while the API still
 * comes from the utilityProcess. Everything else runs fully self-contained.
 */
const DEV_URL = process.env.POKE_SORT_DEV_URL;

const SERVER_ENTRY = app.isPackaged
  ? path.join(process.resourcesPath, "server", "index.js")
  : path.resolve(__dirname, "../../server/dist/index.js");

const STATIC_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "web")
  : path.resolve(__dirname, "../../web/dist");

const MODEL_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "models")
  : path.resolve(__dirname, "../../../.models");

const MIGRATIONS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "drizzle")
  : path.resolve(__dirname, "../../../drizzle");

let serverProcess: UtilityProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let serverStart: Promise<number> | null = null;
let permissionsWired = false;

/**
 * Shown while the server migrates, seeds and warms up — several seconds on a
 * first run. Without it the app is a bouncing dock icon and nothing else.
 */
const SPLASH = `data:text/html,${encodeURIComponent(`
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#000;color:#888;
             font:14px system-ui,-apple-system,sans-serif">Starting PokeSort…</body>`)}`;

const errorPage = (message: string) => `data:text/html,${encodeURIComponent(`
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#000;color:#f87171;
             font:14px system-ui,-apple-system,sans-serif;text-align:center;padding:2rem">
  <div><p><strong>PokeSort could not start.</strong></p><pre style="color:#888;white-space:pre-wrap">${message}</pre></div>
</body>`)}`;

/**
 * The server is started at most once per app run. PGlite is single-process, so
 * a second server against the same data directory is not a slow path — it is
 * corruption. This is reachable on macOS: closing the window does not quit the
 * app, and clicking the dock icon builds a new one.
 */
function ensureServer(): Promise<number> {
  if (!serverStart) serverStart = startServer();
  return serverStart;
}

/**
 * Adopts the data directory left behind by the app's previous name.
 *
 * `userData` is derived from `productName`, so renaming Mault to PokeSort moves
 * it — the old directory (database, scan captures, imported catalog) would
 * otherwise be orphaned and the app would look like a fresh install.
 *
 * The emptiness test is on `db/`, NOT on the directory itself: Electron creates
 * `userData` during startup, before `whenReady` ever fires, so testing
 * `existsSync(next)` is testing something that is always true and the adoption
 * never runs. `db/` is created by the server, so it is the marker that actually
 * distinguishes "this app has run here" from "Electron just made the folder".
 *
 * Contents are moved entry by entry rather than renaming the directory, because
 * by now `next` exists and a directory-to-directory rename fails once Electron
 * has put anything in it.
 *
 * Remove once no install can still be on the old name.
 */
function adoptLegacyDataDir(): void {
  const next = app.getPath("userData");
  const legacy = path.join(path.dirname(next), "Mault");

  if (legacy === next) return;
  if (!fs.existsSync(path.join(legacy, "db"))) return;
  // Already migrated, or this install has its own database — never overwrite.
  if (fs.existsSync(path.join(next, "db"))) return;

  try {
    fs.mkdirSync(next, { recursive: true });
    for (const entry of fs.readdirSync(legacy)) {
      const from = path.join(legacy, entry);
      const to = path.join(next, entry);
      // Anything Electron already created in `next` wins; we are only filling
      // in what is missing, so a partially-adopted state stays consistent.
      if (fs.existsSync(to)) continue;
      fs.renameSync(from, to);
    }
    console.log(`[main] adopted legacy data dir: ${legacy} -> ${next}`);
  } catch (err) {
    // A failed adoption is recoverable — the app starts on an empty data dir
    // and the user can re-import. Losing the window over it is not.
    console.error("[main] could not adopt legacy data dir:", err);
  }
}

/**
 * The Hono server runs in a utilityProcess rather than the main process so a
 * model load or a long catalog sync cannot freeze the UI, and so a crash is
 * recoverable instead of taking the whole app down.
 */
function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(SERVER_ENTRY, [], {
      stdio: "inherit",
      env: {
        ...process.env,
        // Everything the app writes goes under Electron's userData dir.
        POKE_SORT_DATA_DIR: app.getPath("userData"),
        POKE_SORT_MIGRATIONS_DIR: MIGRATIONS_DIR,
        POKE_SORT_STATIC_DIR: STATIC_DIR,
        POKE_SORT_HOST: "127.0.0.1",
        PORT: "0", // ask the OS for a free port
        // Bundled SigLIP weights; never reach for the network on first run.
        // (HF_HOME/TRANSFORMERS_OFFLINE are Python-only — transformers.js reads
        // neither, so the server translates these into `env.cacheDir` itself.)
        POKE_SORT_MODEL_DIR: MODEL_DIR,
        // Only enforced in the packaged app; an unpackaged dev run is allowed
        // to pull the weights down on demand.
        POKE_SORT_MODELS_OFFLINE: app.isPackaged ? "1" : "0",
      },
    });
    serverProcess = child;

    const timer = setTimeout(
      () => reject(new Error("Server did not report a port within 120s")),
      120_000,
    );

    child.on("message", (msg: { type?: string; port?: number }) => {
      if (msg?.type === "listening" && typeof msg.port === "number") {
        clearTimeout(timer);
        resolve(msg.port);
      }
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      serverProcess = null;
      // Clear the memoised start so a reopened window boots a fresh server
      // rather than pointing at a port nothing is listening on. (A no-op for
      // the promise itself if it already resolved.)
      serverStart = null;
      reject(new Error(`Server exited with code ${code}`));
    });
  });
}

/**
 * The origin the permission handlers accept.
 *
 * Deliberately a mutable module-level value rather than a captured argument.
 * The server binds an ephemeral port, so the origin changes whenever the server
 * restarts — and since the handlers below are session-level and wired exactly
 * once, capturing the origin would pin them to the first port forever. After a
 * server crash the window would reload on a new port and `navigator.serial`
 * would go quiet with no error, which is the exact failure this file warns
 * about.
 */
let allowedOrigin: string | null = null;

/** Send to whichever window is alive now, not the one that was alive at wiring. */
function notifyRenderer(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

/**
 * Web Serial is why this app is Electron and not Tauri, and these handlers are
 * the part that fails silently: without all of them `navigator.serial` yields
 * nothing at all, with no error surfaced to the page.
 *
 * Wired once against the default session. Everything that varies per window or
 * per server restart is read at call time.
 */
function wireSerialPermissions(win: BrowserWindow): void {
  const { session } = win.webContents;

  session.on("select-serial-port", (event, portList, _wc, callback) => {
    event.preventDefault();
    if (portList.length === 0) {
      callback("");
      return;
    }
    const preferred = loadPreferredPortId();
    const match = portList.find((p) => p.portId === preferred);
    callback((match ?? portList[0]).portId);
  });

  // Hot-plugging the Arduino mid-session should just work.
  session.on("serial-port-added", (_event, port) => {
    notifyRenderer("poke-sort:serial-ports-changed", { added: port.portId });
  });
  session.on("serial-port-removed", (_event, port) => {
    notifyRenderer("poke-sort:serial-ports-changed", { removed: port.portId });
  });

  session.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (permission !== "serial" && permission !== "media") return false;
    return allowedOrigin !== null && requestingOrigin === allowedOrigin;
  });

  session.setDevicePermissionHandler(
    (details) =>
      details.deviceType === "serial" &&
      allowedOrigin !== null &&
      details.origin === allowedOrigin,
  );

  // Only "media" here. Serial is not part of the permission-request flow at
  // all — it is granted by the check + device handlers above plus
  // select-serial-port, which is why all three are required.
  session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media");
  });
}

async function createWindow(): Promise<void> {
  if (mainWindow) {
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const win = mainWindow;
  win.on("closed", () => {
    mainWindow = null;
  });

  // Paint before waiting on the server, so the app appears immediately.
  await win.loadURL(SPLASH);
  win.show();

  let port: number;
  try {
    port = await ensureServer();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[desktop] Server failed to start:", err);
    // Surface it in the window rather than quitting silently.
    await win.loadURL(errorPage(message));
    return;
  }

  const appUrl = DEV_URL ?? `http://127.0.0.1:${port}`;

  // The origin the handlers check must be the origin the page is actually
  // served from — a mismatch here is the silent-failure mode. Updated on every
  // window because the server's port is ephemeral and changes across restarts.
  allowedOrigin = new URL(appUrl).origin;

  // Wired once: these are session-level listeners and would otherwise stack up
  // each time the window was closed and reopened.
  if (!permissionsWired) {
    wireSerialPermissions(win);
    permissionsWired = true;
  }

  await win.loadURL(appUrl);
}

ipcMain.handle("poke-sort:get-preferred-serial-port", () => loadPreferredPortId());
ipcMain.handle("poke-sort:set-preferred-serial-port", (_e, portId: string | null) => {
  savePreferredPortId(portId);
  return portId;
});

// Two copies of the app would open the same PGlite directory, which is not a
// contention problem but a corruption one. Hand the second launch's focus to
// the window that already exists instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    adoptLegacyDataDir();
    void createWindow();

    app.on("activate", () => {
      void createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  serverProcess?.kill();
  serverProcess = null;
});
