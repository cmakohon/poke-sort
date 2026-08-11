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
const DEV_URL = process.env.MAULT_DEV_URL;

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
             font:14px system-ui,-apple-system,sans-serif">Starting Mault…</body>`)}`;

const errorPage = (message: string) => `data:text/html,${encodeURIComponent(`
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#000;color:#f87171;
             font:14px system-ui,-apple-system,sans-serif;text-align:center;padding:2rem">
  <div><p><strong>Mault could not start.</strong></p><pre style="color:#888;white-space:pre-wrap">${message}</pre></div>
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
        MAULT_DATA_DIR: app.getPath("userData"),
        MAULT_MIGRATIONS_DIR: MIGRATIONS_DIR,
        MAULT_STATIC_DIR: STATIC_DIR,
        MAULT_HOST: "127.0.0.1",
        PORT: "0", // ask the OS for a free port
        // Bundled SigLIP weights; never reach for the network on first run.
        // (HF_HOME/TRANSFORMERS_OFFLINE are Python-only — transformers.js reads
        // neither, so the server translates these into `env.cacheDir` itself.)
        MAULT_MODEL_DIR: MODEL_DIR,
        // Only enforced in the packaged app; an unpackaged dev run is allowed
        // to pull the weights down on demand.
        MAULT_MODELS_OFFLINE: app.isPackaged ? "1" : "0",
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
 * Web Serial is why this app is Electron and not Tauri, and these handlers are
 * the part that fails silently: without all of them `navigator.serial` yields
 * nothing at all, with no error surfaced to the page.
 */
function wireSerialPermissions(win: BrowserWindow, origin: string): void {
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
    win.webContents.send("mault:serial-ports-changed", { added: port.portId });
  });
  session.on("serial-port-removed", (_event, port) => {
    win.webContents.send("mault:serial-ports-changed", {
      removed: port.portId,
    });
  });

  session.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (permission !== "serial" && permission !== "media") return false;
    return requestingOrigin === origin;
  });

  session.setDevicePermissionHandler(
    (details) => details.deviceType === "serial" && details.origin === origin,
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
  // served from — a mismatch here is the silent-failure mode. Wired once:
  // these are session-level listeners and would otherwise stack up if the
  // window were closed and reopened.
  if (!permissionsWired) {
    wireSerialPermissions(win, new URL(appUrl).origin);
    permissionsWired = true;
  }

  await win.loadURL(appUrl);
}

ipcMain.handle("mault:get-preferred-serial-port", () => loadPreferredPortId());
ipcMain.handle("mault:set-preferred-serial-port", (_e, portId: string | null) => {
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
