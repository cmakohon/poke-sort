import { defineConfig } from "tsup";

// CJS with a .cjs extension: Electron loads the main process and the preload
// script by path, and both must be unambiguously CommonJS.
export default defineConfig({
  entry: ["src/main.ts", "src/preload.ts"],
  format: ["cjs"],
  outDir: "dist",
  target: "node20",
  outExtension: () => ({ js: ".cjs" }),
  external: ["electron"],
  // The splash and error pages are self-contained data: URLs, so the app icon
  // they show has to be inlined rather than read from disk at runtime.
  loader: { ".png": "dataurl" },
});
