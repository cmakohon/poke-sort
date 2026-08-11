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
  serial: {
    getPreferredPortId: (): Promise<string | null> =>
      ipcRenderer.invoke("poke-sort:get-preferred-serial-port"),
    setPreferredPortId: (portId: string | null): Promise<string | null> =>
      ipcRenderer.invoke("poke-sort:set-preferred-serial-port", portId),
    onPortsChanged: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("poke-sort:serial-ports-changed", handler);
      return () => ipcRenderer.removeListener("poke-sort:serial-ports-changed", handler);
    },
  },
});
