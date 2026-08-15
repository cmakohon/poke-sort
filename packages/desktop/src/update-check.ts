import { app } from "electron";

/**
 * Tells the app when a newer release exists. It does not install anything.
 *
 * electron-updater would be the obvious choice and cannot work here: on macOS
 * it hands the download to Squirrel.Mac, which refuses any update whose code
 * signature does not match the running app's. This app is ad-hoc signed (see
 * scripts/adhoc-sign.mjs), so every such update would fail — quietly, and after
 * downloading a few hundred MB. Pointing a person at the release page is the
 * honest version of the same feature until there is a Developer ID.
 */

const REPO = "cmakohon/poke-sort";

export interface UpdateInfo {
  version: string;
  url: string;
}

/**
 * App releases are tagged `vX.Y.Z`. Data assets get their own tags — the card
 * catalog ships as `catalog-v3` — and are not app releases; GitHub will happily
 * report one as "latest" when it is the only release in the repo, so the shape
 * of the tag is what decides whether it is a version at all.
 */
const APP_TAG = /^v\d+\.\d+\.\d+/;

/** `1.2.10` beats `1.2.9`, which a string compare gets wrong. */
function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      // A prerelease suffix is not compared, just ignored: GitHub's "latest"
      // never points at one, so it cannot show up here anyway.
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);

  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

async function fetchLatest(): Promise<UpdateInfo | null> {
  // 8s: this runs while the user is waiting on the splash. A slow answer is
  // worth less than a fast startup.
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8_000),
    },
  );
  // 404 is the normal answer before the first release is published — the
  // endpoint excludes drafts and prereleases.
  if (!response.ok) return null;

  const release = (await response.json()) as {
    tag_name?: string;
    html_url?: string;
  };
  if (!release.tag_name || !release.html_url) return null;
  if (!APP_TAG.test(release.tag_name)) return null;
  if (!isNewer(release.tag_name, app.getVersion())) return null;

  return { version: release.tag_name.replace(/^v/, ""), url: release.html_url };
}

let inFlight: Promise<UpdateInfo | null> | null = null;

/**
 * Memoised for the life of the process. The renderer asks on mount and the menu
 * item asks on click; neither should cost a second round trip, and GitHub's
 * unauthenticated rate limit is per-IP.
 */
export function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!inFlight) {
    inFlight = fetchLatest().catch((err) => {
      // Being offline is the expected case for a machine that sorts cards in a
      // basement, not something to interrupt anyone about.
      console.log("[update] check failed:", (err as Error).message);
      return null;
    });
  }
  return inFlight;
}
