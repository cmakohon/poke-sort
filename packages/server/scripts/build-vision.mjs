// Compiles the Apple Vision OCR sidecar (native/vision-ocr.swift).
//
//   node scripts/build-vision.mjs
//
// macOS only, and a no-op everywhere else — Vision is a system framework, so
// there is nothing to build on Windows or Linux and the server falls back to
// tesseract.js there (see src/lib/identify/ocr.ts). Exits 0 either way so it
// can sit unconditionally in a build pipeline.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "native", "vision-ocr.swift");
const out = path.join(here, "..", "native", "vision-ocr");

if (process.platform !== "darwin") {
  console.log("[vision] not darwin — skipping (Tesseract is the recogniser there)");
  process.exit(0);
}
if (process.env.POKE_SORT_SKIP_VISION === "1") {
  console.log("[vision] POKE_SORT_SKIP_VISION=1 — skipping");
  process.exit(0);
}
if (!existsSync(src)) {
  console.error(`[vision] missing source: ${src}`);
  process.exit(1);
}
// Skip when the binary is newer than the source; this runs on every build.
if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) {
  console.log("[vision] up to date");
  process.exit(0);
}
mkdirSync(path.dirname(out), { recursive: true });
try {
  execFileSync("swiftc", ["-O", "-o", out, src], { stdio: "inherit" });
  console.log(`[vision] built ${path.relative(process.cwd(), out)}`);
} catch (err) {
  // Loud on macOS, deliberately. Packaging tolerates a missing sidecar (the
  // extraResources entry copies the directory, and the server probes before
  // using it) — which means a broken toolchain would otherwise ship a macOS
  // build silently reading with Tesseract, at 269 collector numbers instead of
  // 936. That is the failure this project least wants to discover in a sorting
  // session. Set POKE_SORT_SKIP_VISION=1 to build without it on purpose.
  console.error(`[vision] swiftc failed: ${err}`);
  console.error(
    "[vision] The macOS build would silently fall back to tesseract.js.\n" +
      "         Install the Xcode command line tools, or set " +
      "POKE_SORT_SKIP_VISION=1 to accept that.",
  );
  process.exit(1);
}
