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
  const port = await startServer();
  const appUrl = DEV_URL ?? `http://127.0.0.1:${port}`;

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

  // The origin the handlers check must be the origin the page is actually
  // served from — a mismatch here is the silent-failure mode.
  wireSerialPermissions(mainWindow, new URL(appUrl).origin);

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  await mainWindow.loadURL(appUrl);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("mault:get-preferred-serial-port", () => loadPreferredPortId());
ipcMain.handle("mault:set-preferred-serial-port", (_e, portId: string | null) => {
  savePreferredPortId(portId);
  return portId;
});

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (err) {
    console.error("[desktop] Failed to start:", err);
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  serverProcess?.kill();
  serverProcess = null;
});
