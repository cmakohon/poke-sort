import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["eval/**/*.test.ts"],
    // The accuracy run embeds every fixture; it is minutes, not seconds.
    testTimeout: 600_000,
    hookTimeout: 120_000,
    // PGlite is single-process — one data directory, one worker.
    fileParallelism: false,
  },
});
