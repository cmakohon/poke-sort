// Turns the source art in /icon into the two PNGs electron-builder packages.
//
// Run by hand — `pnpm --filter @poke-sort/desktop icons` — when the art
// changes. The outputs are committed on purpose: packaging runs on three
// runners, and none of them should need sharp, ImageMagick or iconutil to
// produce an icon. electron-builder derives icon.icns, icon.ico and the Linux
// png set from these at build time.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../../../icon/icon.png"); // 1024x1024 RGBA
const OUT = path.resolve(here, "../build");

await mkdir(OUT, { recursive: true });

// Windows and Linux draw an icon edge to edge in a fixed box, so they get the
// artwork at full bleed.
await sharp(SRC).resize(1024, 1024).png().toFile(path.join(OUT, "icon.png"));

// macOS does not. Apple's icon grid sits a rounded-rectangle icon in an 824x824
// box inside a 1024x1024 canvas — 100px of transparency on every side — and the
// Dock, Finder and Launchpad all lay out assuming that margin is there. Ship
// the full-bleed art on macOS and PokeSort is visibly bigger than every other
// icon on the system.
const artwork = await sharp(SRC).resize(824, 824).png().toBuffer();
await sharp({
  create: {
    width: 1024,
    height: 1024,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: artwork, top: 100, left: 100 }])
  .png()
  .toFile(path.join(OUT, "icon-mac.png"));

// Inlined into the splash screen by tsup — see src/splash.ts.
await sharp(SRC).resize(256, 256).png().toFile(path.join(OUT, "icon-256.png"));

console.log(`Wrote icon.png, icon-mac.png and icon-256.png to ${OUT}`);
