/**
 * Screenshots the running app, so a layout change can be looked at instead of
 * argued about.
 *
 *   pnpm --filter @poke-sort/web screenshot
 *   pnpm --filter @poke-sort/web screenshot -- /collections 1600x1000 1100x1000
 *
 * IMPORTANT: this attaches to whatever is already serving and never starts a
 * server of its own. PGlite is single-process — a second opener of the data
 * directory corrupts the WAL, and it has already cost this project one broken
 * launch. Start the app (or `pnpm dev`) first; this only looks.
 *
 * Drives the Chrome already installed on the machine via `channel: "chrome"`,
 * so no browser download is needed. If Chrome is absent, run
 * `pnpm exec playwright install chromium` once and drop the channel option.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT_DIR = path.resolve(process.cwd(), "screenshots");

/** Where the Electron app writes the port it settled on. */
const PORT_FILES = [
  path.resolve(process.cwd(), "../server/.poke-sort-catalog/server.port"),
  path.resolve(process.cwd(), "../server/.poke-sort/server.port"),
];

async function serves(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/collections`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The app's own origin is preferred over the Vite dev server: Vite proxies
 * /api to a fixed port, so with the packaged app running on an ephemeral one
 * the dev origin renders an empty database and every screenshot is a lie.
 */
async function findAppUrl(): Promise<string> {
  const candidates: string[] = [];
  if (process.env.POKE_SORT_URL) candidates.push(process.env.POKE_SORT_URL);
  for (const file of PORT_FILES) {
    if (existsSync(file)) {
      const port = readFileSync(file, "utf-8").trim();
      if (port) candidates.push(`http://localhost:${port}`);
    }
  }
  candidates.push("http://localhost:3001", "http://localhost:5173");

  for (const url of candidates) {
    if (await serves(url)) return url;
  }
  throw new Error(
    "Nothing is serving the app. Start it first (this script never starts a " +
      "server itself — a second opener of the PGlite directory corrupts it), " +
      "or set POKE_SORT_URL.",
  );
}

function parseSize(value: string): { width: number; height: number } {
  const [w, h] = value.split("x").map(Number);
  if (!w || !h) throw new Error(`Bad size "${value}", expected WIDTHxHEIGHT`);
  return { width: w, height: h };
}

async function main() {
  const args = process.argv.slice(2);
  const route = args.find((a) => a.startsWith("/")) ?? "/collections";
  const sizes = args.filter((a) => /^\d+x\d+$/.test(a)).map(parseSize);
  if (sizes.length === 0) sizes.push({ width: 1600, height: 1000 });

  const base = await findAppUrl();
  console.log(`Serving from ${base}`);

  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });

  try {
    for (const size of sizes) {
      const page = await browser.newPage({ viewport: size });
      await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
      // The shell paints before its data arrives; without this the shot is of
      // a loading spinner often enough to be useless.
      await page.waitForTimeout(1500);

      const name = `${route.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "root"}-${size.width}x${size.height}.png`;
      await page.screenshot({ path: path.join(OUT_DIR, name), fullPage: true });
      console.log(`  ${name}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${readdirSync(OUT_DIR).length} file(s) in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
