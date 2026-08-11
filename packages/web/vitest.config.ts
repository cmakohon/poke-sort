import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // The tree under test touches document.documentElement; keep it one file
    // at a time rather than reasoning about shared globals.
    fileParallelism: false,
  },
});
