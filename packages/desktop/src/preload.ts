import { contextBridge, ipcRenderer } from "electron";

/**
 * Minimal bridge. The renderer does NOT need the server port — the SPA is
 * served from that same server, so every `/api/...` call is already
 * same-origin. This exposes only what the web app cannot get from the DOM:
 * which serial device the shell will auto-select, and a nudge when the set of
 * attached devices changes.
 */
contextBridge.exposeInMainWorld("pokeSort", {
  isDesktop: true,
  updates: {
    /** Null when up to date, offline, or running unpackaged. */
    getAvailable: (): Promise<{ version: string; url: string } | null> =>
      ipcRenderer.invoke("poke-sort:get-update-info"),
    /**
     * Goes through the main process rather than window.open: the shell owns
     * which URLs may reach a browser, and the renderer should not be the thing
     * deciding that.
     */
    openReleasePage: (url: string): Promise<void> =>
      ipcRenderer.invoke("poke-sort:open-release-page", url),
  },
  serial: {
    getPreferredPortId: (): Promise<string | null> =>
      ipcRenderer.invoke("poke-sort:get-preferred-serial-port"),
    setPreferredPortId: (portId: string | null): Promise<string | null> =>
      ipcRenderer.invoke("poke-sort:set-preferred-serial-port", portId),
    /**
     * Fires when the shell needs a person to choose between attached devices.
     * Only ever called when more than one real USB device is present and none
     * is the remembered one — the page's requestPort() is waiting on the reply.
     */
    onSelectRequest: (listener: (ports: unknown[]) => void) => {
      const handler = (_e: unknown, ports: unknown[]) => listener(ports);
      ipcRenderer.on("poke-sort:serial-select-request", handler);
      return () =>
        ipcRenderer.removeListener("poke-sort:serial-select-request", handler);
    },
    /** Answers the request above. `null` cancels, and requestPort() rejects. */
    respondToSelect: (portId: string | null) =>
      ipcRenderer.send("poke-sort:serial-select-response", portId),
    onPortsChanged: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("poke-sort:serial-ports-changed", handler);
      return () => ipcRenderer.removeListener("poke-sort:serial-ports-changed", handler);
    },
  },
});
