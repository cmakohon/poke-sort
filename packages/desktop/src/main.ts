import fs from "node:fs";
import path from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import {
  loadPreferredPort,
  matchScore,
  savePreferredPort,
  type SerialPortIdentity,
} from "./serial-prefs";

/**
 * Must run before anything asks for `userData`, which is derived from it.
 *
 * `productName` in electron-builder.yml only applies to a packaged build, so an
 * unpackaged `electron dist/main.cjs` fell back to Electron's default name and
 * wrote to `<appData>/Electron` — a directory *every* unpackaged Electron app on
 * the machine shares. That is a database this app does not exclusively own, and
 * it meant the dev app and the real app silently kept separate data.
 */
app.setName("PokeSort");

/**
 * Dev mode points the window at the Vite dev server (HMR) while the API still
 * comes from the utilityProcess. Everything else runs fully self-contained.
 */
const DEV_URL = process.env.POKE_SORT_DEV_URL;

/**
 * The one directory a dev run uses unless told otherwise.
 *
 * Unpackaged runs used to default to `userData`, the same directory the packaged
 * app owns, so a dev session and a real install shared a library while a
 * `dev:catalog` script pointed somewhere else entirely. Three ways to launch, two
 * databases, and the symptom was never "you opened the other one" — it was "my
 * calibration reset".
 *
 * Resolved from `__dirname`, not cwd: this is the same directory `SERVER_ENTRY`
 * is found relative to, so it holds wherever the launcher was invoked from. It
 * also means no shell variable is involved, which is what the `dev` script used
 * to rely on — and `export VAR=...` is not a thing on Windows.
 */
const DEV_DATA_DIR = path.resolve(__dirname, "../../server/.poke-sort-catalog");

/**
 * Where the server keeps the database and captures.
 *
 * A packaged app always uses `userData` — it owns that directory and an
 * environment variable should not be able to move a user's library out from
 * under them. Unpackaged, an explicit `POKE_SORT_DATA_DIR` wins, so a dev run can
 * be pointed at the packaged library or anywhere else; with nothing set it is the
 * dev install above. The value used to be overwritten unconditionally, so setting
 * it did nothing and the override looked broken.
 */
function resolveDataDir(): string {
  if (app.isPackaged) return app.getPath("userData");

  // The server resolves a relative value against its own cwd, so resolve it the
  // same way here and log the absolute path. A relative override that lands
  // somewhere unintended otherwise looks identical to one that worked.
  const override = process.env.POKE_SORT_DATA_DIR;
  const resolved = override ? path.resolve(override) : DEV_DATA_DIR;
  console.log(
    override
      ? `[main] POKE_SORT_DATA_DIR override -> ${resolved}`
      : `[main] dev data dir -> ${resolved}`,
  );

  // An empty or wrong path is not an error — the server will happily create the
  // directory, migrate, seed, and come up with a catalog of zero cards, which
  // looks like the app lost its data rather than like a bad path. Say so.
  if (!fs.existsSync(path.join(resolved, "db"))) {
    console.warn(
      `[main] No database at ${resolved}; a new empty one will be created there.`,
    );
  }
  return resolved;
}

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
        // Everything the app writes goes under one directory (see
        // resolveDataDir: userData, unless a dev run overrides it).
        POKE_SORT_DATA_DIR: resolveDataDir(),
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

/**
 * Compares origins by value, not by string.
 *
 * Electron is not consistent about what it hands these callbacks:
 * `setPermissionCheckHandler` receives a serialised URL *with* a trailing slash
 * ("http://127.0.0.1:53932/"), while `setDevicePermissionHandler` receives a
 * bare origin ("http://127.0.0.1:53932"). `new URL(appUrl).origin` produces the
 * bare form, so a `===` against the check handler's argument was always false.
 *
 * Every permission this app needs — the camera and Web Serial — went through
 * that comparison, so both were denied, silently, on every launch. Serial then
 * failed twice over: the device handler agreed, but the check handler did not,
 * so `select-serial-port` never fired and requestPort() rejected with "No port
 * selected by the user" even with the Arduino plugged in and visible to macOS.
 */
/**
 * Whether a URL is safe to hand to the OS.
 *
 * openExternal launches whatever program is registered for the scheme, so the
 * scheme is the whole security boundary: `file:` opens a file manager, and a
 * custom scheme opens whatever claimed it. Restricting to the two web schemes
 * means the worst a crafted link can do is open a browser tab.
 */
function isSafeExternalUrl(candidate: string): boolean {
  try {
    const { protocol } = new URL(candidate);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function isAllowedOrigin(candidate: string | undefined | null): boolean {
  if (!candidate || allowedOrigin === null) return false;
  try {
    return new URL(candidate).origin === allowedOrigin;
  } catch {
    // Opaque or unparseable origins ("null", a data: URL) are never the app.
    return false;
  }
}

/** Send to whichever window is alive now, not the one that was alive at wiring. */
function notifyRenderer(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

/**
 * A pending `select-serial-port` answer.
 *
 * Electron lets the callback be held rather than answered inline, which is what
 * makes a prompt possible at all: the page's requestPort() stays unresolved
 * while the user chooses. Exactly one can be outstanding — a second request
 * while a dialog is open answers the first with nothing rather than leaking a
 * callback that never fires.
 */
let pendingSelect:
  | { callback: (portId: string) => void; timer: NodeJS.Timeout }
  | null = null;

/** How long to wait for the renderer before falling back to the heuristic. */
const SELECT_PROMPT_TIMEOUT_MS = 60_000;

interface OfferedPort {
  portId: string;
  portName?: string;
  displayName?: string;
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
}

function resolvePendingSelect(portId: string): void {
  if (!pendingSelect) return;
  const { callback, timer } = pendingSelect;
  pendingSelect = null;
  clearTimeout(timer);
  callback(portId);
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

    // Taking portList[0] is wrong on a real Mac. macOS exposes several virtual
    // serial ports that always enumerate, and alphabetically the first is
    // usually one of them — on the machine this was found on the list was
    // Bluetooth-Incoming-Port, debug-console, usbmodem141101, wlan-debug, so
    // the Arduino sat third behind two devices that will never answer.
    //
    // Only a physically attached USB device reports a vendor and product id;
    // the virtual ports report neither. That is the distinction worth picking
    // on, rather than a hardcoded Arduino vendor id that would break the moment
    // the board is swapped.
    // Ranked, best first: the exact board the user chose before, then any
    // board of the same model, then any physically attached USB device, then
    // whatever is left. portId is deliberately not part of this — Electron
    // regenerates it every launch, so it identifies nothing across sessions.
    const preferred = loadPreferredPort();
    const ranked = preferred
      ? [...portList].sort((a, b) => matchScore(b, preferred) - matchScore(a, preferred))
      : portList;
    const remembered =
      preferred && matchScore(ranked[0], preferred) > 0 ? ranked[0] : null;

    // Only physical USB devices report ids; the virtual ports macOS always
    // exposes (Bluetooth-Incoming-Port, debug-console, wlan-debug) report none,
    // so they are never worth offering as a choice.
    const candidates = portList.filter((p) => p.vendorId && p.productId);

    const accept = (port: (typeof portList)[number], why: string) => {
      console.log(
        `[main] serial: ${portList.length} port(s), chose ${port.portName ?? port.portId} (${why})`,
      );
      if (port.vendorId && port.productId) {
        savePreferredPort({
          vendorId: port.vendorId,
          productId: port.productId,
          serialNumber: port.serialNumber,
        });
      }
      callback(port.portId);
    };

    // Never ask twice for the same machine, and never ask when there is nothing
    // to decide. A prompt is only worth a person's attention when more than one
    // real device is attached and none of them is the one already chosen.
    if (remembered) return accept(remembered, "remembered");
    if (candidates.length === 1) return accept(candidates[0], "only USB device");
    if (candidates.length === 0) return accept(portList[0], "no USB device");

    const win = mainWindow;
    if (!win || win.isDestroyed()) {
      return accept(candidates[0], "no window to ask");
    }

    // A second request while a dialog is open answers the first with nothing,
    // rather than leaving a callback that never fires.
    resolvePendingSelect("");

    const offered: OfferedPort[] = candidates.map((p) => ({
      portId: p.portId,
      portName: p.portName,
      displayName: p.displayName,
      vendorId: p.vendorId,
      productId: p.productId,
      serialNumber: p.serialNumber,
    }));

    console.log(`[main] serial: asking which of ${offered.length} devices to use`);
    pendingSelect = {
      callback: (portId) => {
        const picked = candidates.find((p) => p.portId === portId);
        if (!picked) {
          // Cancelled, or the device went away while the dialog was open.
          console.log("[main] serial: no device chosen");
          callback("");
          return;
        }
        accept(picked, "chosen by the user");
      },
      timer: setTimeout(() => {
        console.warn("[main] serial: prompt timed out; using the first USB device");
        resolvePendingSelect(candidates[0].portId);
      }, SELECT_PROMPT_TIMEOUT_MS),
    };
    win.webContents.send("poke-sort:serial-select-request", offered);
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
    return isAllowedOrigin(requestingOrigin);
  });

  session.setDevicePermissionHandler(
    (details) =>
      details.deviceType === "serial" && isAllowedOrigin(details.origin),
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

  // Every link the app renders points somewhere on the web — a card on
  // TCGdex, a product on TCGplayer, the Discord docs. Electron's default for
  // target="_blank" is a second BrowserWindow with no address bar, no back
  // button and no way to bookmark or share what it is showing.
  //
  // NOT inside the permissionsWired guard below: that guard exists because
  // wireSerialPermissions attaches session-level listeners that would stack.
  // This one is per-webContents, and `closed` nulls mainWindow, so a reopened
  // window needs its own or it goes back to spawning popups.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
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

  // The same-window counterpart: a plain <a href> with no target replaces the
  // app itself, stranding the user with no way back. Attached only now that
  // allowedOrigin is set, so the splash data: URL and a stale origin from a
  // previous window cannot be measured against the wrong value. SPA routing
  // and HMR are same-origin and pass straight through; loadURL below does not
  // fire this event.
  win.webContents.on("will-navigate", (event, url) => {
    if (isAllowedOrigin(url)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });

  // Wired once: these are session-level listeners and would otherwise stack up
  // each time the window was closed and reopened.
  if (!permissionsWired) {
    wireSerialPermissions(win);
    permissionsWired = true;
  }

  await win.loadURL(appUrl);
}

ipcMain.on("poke-sort:serial-select-response", (_e, portId: string | null) => {
  resolvePendingSelect(portId ?? "");
});

ipcMain.handle("poke-sort:get-preferred-serial-port", () => loadPreferredPort());
ipcMain.handle(
  "poke-sort:set-preferred-serial-port",
  (_e, identity: SerialPortIdentity | null) => {
    savePreferredPort(identity);
    return identity;
  },
);

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

/**
 * How long to wait for the server to close its database before quitting anyway.
 * Closing PGlite is normally instant; this only bounds a pathological case.
 */
const SERVER_EXIT_GRACE_MS = 6000;

let quitting = false;

/**
 * Waits for the server to shut down before the app exits.
 *
 * `kill()` on its own returned immediately and Electron tore the process down
 * behind it, so PGlite — a real Postgres writing real files — was killed
 * mid-write on every quit and had to crash-recover on the next boot. The server
 * closes its database on SIGTERM; this is the half that gives it time to.
 *
 * `app.exit` rather than `app.quit`, because exit skips `before-quit` and so
 * cannot re-enter this handler.
 */
app.on("before-quit", (event) => {
  if (quitting) return;
  const child = serverProcess;
  if (!child) return;

  event.preventDefault();
  quitting = true;

  const finish = (reason: string) => {
    console.log(`[main] Server shutdown: ${reason}`);
    serverProcess = null;
    app.exit(0);
  };

  const timer = setTimeout(() => {
    console.warn("[main] Server did not exit in time; quitting anyway.");
    finish("timed out");
  }, SERVER_EXIT_GRACE_MS);

  child.once("exit", () => {
    clearTimeout(timer);
    finish("clean");
  });

  child.kill();
});
