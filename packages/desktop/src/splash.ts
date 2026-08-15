// The two pages the shell can show before the SPA exists: the splash it paints
// while the server migrates and warms up, and the dead-end it paints if that
// never finishes.
//
// Both are `data:` URLs with an explicit charset. Without one, RFC 2397 says a
// data: URL defaults to US-ASCII, so Chromium reads percent-encoded UTF-8 back
// as Latin-1 and "Starting PokeSort…" paints as "Starting PokeSortâ€¦". The
// error page needs it just as much even though its own text is ASCII: it
// interpolates arbitrary messages, and paths and exception text are not.
//
// The icon is inlined at build time by tsup's dataurl loader (see
// tsup.config.ts), which keeps these pages self-contained — no extraResources
// entry to keep in sync, and no file read on a path that differs between a
// packaged and an unpackaged run.
import iconDataUrl from "../build/icon-256.png";

const shell = (body: string) => `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<style>
  @keyframes rise { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
  @keyframes breathe { 0%, 100% { opacity: .35 } 50% { opacity: .9 } }
  html, body { margin: 0; height: 100%; }
  body {
    display: grid;
    place-items: center;
    background: #000;
    color: #a1a1aa;
    font: 13px/1.5 system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
    user-select: none;
    cursor: default;
  }
  .stack { display: grid; justify-items: center; gap: 18px; animation: rise .4s ease-out both; }
  /* The artwork carries its own rounded corners, so it needs no mask — just a
     shadow to lift it off a pure black background. */
  img { width: 88px; height: 88px; filter: drop-shadow(0 8px 24px rgba(220, 38, 38, .35)); }
  .name { font-size: 15px; font-weight: 650; color: #fafafa; letter-spacing: -.01em; }
  .status { animation: breathe 2s ease-in-out infinite; }
  .error { color: #f87171; font-weight: 600; }
  pre {
    margin: 0;
    max-width: 46ch;
    white-space: pre-wrap;
    word-break: break-word;
    text-align: left;
    font: 11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #71717a;
  }
</style>
<body><div class="stack">${body}</div></body>
</html>`)}`;

/**
 * Shown while the server migrates, seeds and warms up — several seconds on a
 * first run. Without it the app is a bouncing dock icon and nothing else.
 */
export const SPLASH = shell(`
  <img src="${iconDataUrl}" alt="">
  <div class="name">PokeSort</div>
  <div class="status">Starting up…</div>
`);

export const errorPage = (message: string) =>
  shell(`
  <img src="${iconDataUrl}" alt="">
  <div class="name error">PokeSort could not start</div>
  <pre>${message.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</pre>
`);
