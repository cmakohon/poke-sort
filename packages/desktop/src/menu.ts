import { app, dialog, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { checkForUpdate } from "./update-check";

const REPO_URL = "https://github.com/cmakohon/poke-sort";

/**
 * Replaces Electron's stock menu, which names the app "Electron" in its About
 * item and offers a Help menu pointing at electronjs.org.
 *
 * Deliberately thin: this is a kiosk-ish app driving a machine on a desk, and
 * the only things worth a menu item are the ones with no in-app equivalent —
 * the standard edit/window commands the OS expects to exist, a way to reach the
 * data directory, and a manual update check.
 */
export function buildMenu(): void {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { label: "Check for Updates…", click: () => void promptForUpdate() },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }] },
    {
      role: "help",
      submenu: [
        {
          // The one thing people ask for that no screen in the app exposes:
          // where the database, captures and calibration actually live.
          label: "Show Data Folder",
          click: () => void shell.openPath(app.getPath("userData")),
        },
        { label: "Project on GitHub", click: () => void shell.openExternal(REPO_URL) },
        ...(isMac
          ? []
          : ([
              { type: "separator" },
              { label: "Check for Updates…", click: () => void promptForUpdate() },
              { role: "about" },
            ] satisfies MenuItemConstructorOptions[])),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * The menu path is the only one that reports "you are up to date" — the
 * in-app notice stays silent when there is nothing to say, but someone who
 * explicitly asked deserves an answer either way.
 */
async function promptForUpdate(): Promise<void> {
  if (!app.isPackaged) {
    await dialog.showMessageBox({
      type: "info",
      message: "Update checks are disabled in development.",
      detail: "An unpackaged run reports Electron's version, not the app's.",
    });
    return;
  }

  const update = await checkForUpdate();
  if (!update) {
    await dialog.showMessageBox({
      type: "info",
      message: `PokeSort ${app.getVersion()} is the latest version.`,
    });
    return;
  }

  const { response } = await dialog.showMessageBox({
    type: "info",
    message: `PokeSort ${update.version} is available.`,
    detail: `You are running ${app.getVersion()}.`,
    buttons: ["Download", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) await shell.openExternal(update.url);
}
