# PokeSort

A Pokémon card scanner and physical sorter. A webcam identifies cards via AI image embeddings, a rule engine decides which bin each card belongs in, and an Arduino-driven feeder and servo mechanism physically routes the card there.

Everything runs on the machine in front of you: no accounts, no hosted database, no network dependency beyond fetching card metadata and prices.

## Credit and provenance

PokeSort is a fork of **[mault](https://github.com/dishwasher-detergent/mault)** by
[Kenneth Bass](https://github.com/dishwasher-detergent) (`dishwasher-detergent`).
The original project is the substance of this one: the sorter concept, the
hardware design, the Arduino firmware, the 3D-printable enclosure, the scan
region calibration approach, the bin rule engine, and the React/Hono/Drizzle
application it all runs on. If you find this useful, the credit belongs upstream —
please star the original and take a look at the
[hardware design](https://makerworld.com/en/models/3066180-tcg-card-sorting-machine#profileId-3451252).

This fork exists because the machine on my desk sorts Pokémon, and mault is
built as a hosted multi-tenant web app spanning several games. That reach is the
right shape for the project it is; this one trades it for depth in a single
game, running entirely on one desk. Different goals, same foundation.

### What this fork changed

|                | mault (upstream)                        | PokeSort                                                                |
| -------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| Games          | Magic, Pokémon, Gundam                  | Pokémon only                                                            |
| Deployment     | Docker images on Coolify                | double-clickable Electron app                                           |
| Database       | Neon Postgres (hosted)                  | PGlite (embedded, in the app's data dir)                                |
| Auth           | Neon Auth, orgs, members, invites       | none — one local user                                                   |
| Card data      | Scryfall + TCGdex + Gundam adapters     | TCGdex only                                                             |
| Identification | one embedding, top-5, take the first    | embedding + OCR + collector number, re-ranked behind a confidence gate  |

The Magic and Gundam adapters, the Scryfall integration, the auth system, and
the marketing site are removed rather than disabled. Fields that were
Magic-shaped but repurposed for Pokémon were renamed to say what they now hold:
`colorIdentity` → `types`, `cmc` → `retreatCost`, `toughness` → `hp`, and the
`scryfall_id` column → `card_id`.

Upstream remains the place to go for the hardware. This fork ships only the app.

## Project status

**v1.1.0 is the first tagged release** — the first build anyone can download and
install rather than clone and run. It packages the SPA, the Hono server and
~100 MB of SigLIP weights into one double-clickable app that works offline.

What is proven, and what is not:

| | |
| --- | --- |
| **macOS (Apple Silicon)** | Install path verified from the published DMG: mounts, installs, clears Gatekeeper, launches, and imports the catalog. The only platform with real hardware behind it. |
| **Windows / Linux** | Build in CI and produce installers. Neither has been run — treat them as untested. |
| **macOS (Intel)** | Not built. The runner is arm64 and the bundle is single-arch. |
| **Code signing** | Ad-hoc, no Apple Developer ID, so first launch needs the [Gatekeeper workaround](#install). Not notarized. |
| **Updates** | Notify-only — the app checks for a newer release and opens the release page. Nothing self-installs. |
| **Card catalog** | 21,714 Pokémon cards, published as a downloadable pack and imported on first run. |

The sorter itself — scanning, fused identification, rule-based binning, review,
calibration, remote monitoring — is in day-to-day use on the machine this was
built for. In-flight work is tracked in the [working plan](#working-plan), not
here.

## Install

Download the newest installer from the
[releases page](https://github.com/cmakohon/poke-sort/releases). The macOS build
is **Apple Silicon only**.

PokeSort is ad-hoc signed rather than signed with an Apple Developer ID, so
macOS quarantines it and refuses the first launch with *"Apple could not verify
PokeSort is free of malware"*. Open **System Settings → Privacy & Security**,
find the PokeSort message and click **Open Anyway**. Right-click → Open has not
worked since macOS 15. The equivalent from a terminal:

```bash
xattr -dr com.apple.quarantine /Applications/PokeSort.app
```

Ad-hoc signing is not cosmetic — Apple Silicon refuses to run an entirely
unsigned bundle, so `packages/desktop/scripts/adhoc-sign.mjs` signs the app
during packaging. One consequence: the signature's identity is its cdhash, which
changes with every build, so macOS asks for camera permission again after each
update.

On first launch the card catalog is empty and nothing can be identified. The app
prompts for a one-time import of a prebuilt embedding pack (~66 MB) from the
`catalog-v3` release; see [Catalog](#catalog).

## Working plan

The local-first migration plan — phase write-ups, what shipped, what is still
open — lives outside the repo at:

```
~/.claude/plans/parsed-mixing-hearth.md
```

It is the source of truth for in-flight work and is not checked in (it is a
personal working document, not project documentation). Read it first when
picking this project back up.

## How it works

1. A feeder mechanism (continuous-rotation servo + roller) pulls a card from the hopper into view of the webcam, into a fixed, per-camera-calibrated scan region (see calibration screen)
2. The browser crops that region to a straightened card image (plain Canvas 2D, no computer vision needed, since the camera mounting and card size are fixed and calibrated ahead of time)
3. The image is sent to the server for embedding search (Hugging Face SigLIP)
4. Vector similarity search (pgvector, in an embedded PGlite database) returns the nearest candidates
5. Local OCR reads the card's name and collector number, and the candidates are re-ranked on the fused signal; a low-confidence result routes to a review bin instead of being guessed
6. Configurable, per-collection bin rules decide which bin the card should go to
7. The web app sends a serial command to the Arduino, which drives the trapdoor/paddle/pusher servos to route the card into that bin

## Features

- Live webcam scanning with automatic card detection and identification; captures wait for the card to physically settle at the sensor before the shot is taken
- Fused identification: SigLIP image embedding, Tesseract OCR of the name and collector number, and set-code matching, re-ranked together behind a confidence gate that sends ambiguous cards to review rather than mis-sorting them
- Rule-based sort bins, grouped by collection, with and/or rule trees across Pokémon card fields (energy type, rarity, HP, set, series, price, regulation mark, legality, and more)
- Card grid sorting and filtering by energy type, rarity and set
- Multiple collections, each with their own bin configuration and card history
- Remote monitoring: watch an in-progress scan session live from another device
- Discord notifications for sorter errors/jams, plus an optional per-card-scanned notification with the card's image, name, price, collection, and a link to watch the session live
- Branding and scanner layout settings
- Feeder, servo, and camera scan-region calibration tools: the camera's capture region can be dragged/resized live against the feed to match different webcam mountings and fields of view

## Stack

- **Web**: React 19, Vite, React Router v7, Tailwind CSS 4, TanStack Query
- **Desktop**: Electron 43 (Chromium is the only engine with Web Serial), packaged with electron-builder
- **Server**: Hono 4, Drizzle ORM, PGlite (embedded WASM Postgres) with pgvector + pg_trgm
- **Card data**: TCGdex
- **Auth**: none — single local user, no accounts, no network storage
- **Hardware**: Arduino Uno R4 via Web Serial API (9600 baud), PCA9685 servo driver
- **Monorepo**: Turborepo + pnpm workspaces

## Project structure

```
packages/
├── shared/   @poke-sort/shared  - types, constants, evaluate-bin rule engine
├── server/   @poke-sort/server  - Hono API, Drizzle schema, embedded PGlite database
├── web/      @poke-sort/web     - React SPA (scanner, bins, collections, calibration, admin)
└── desktop/  @poke-sort/desktop - Electron shell: window, utilityProcess, Web Serial permissions
arduino/      Arduino sketch (arduino/main/main.ino)
"3d model"/   Printable enclosure/module design (Fusion 360 + .3mf)
drizzle/      Generated SQL migrations
scripts/      Release helper (version bump, changelog, tag)
```

## Getting started

```bash
pnpm install
pnpm dev        # Vite on :5173, Hono on :3001
```

### Environment variables

Everything lives in a single root `.env` (Vite is configured to read up from `packages/web`, so there's no separate `packages/web/.env`). Copy `.env.example` to `.env` and fill it in:

```bash
cp .env.example .env
```

```
# Server - all optional; the app runs with no .env at all
PORT=                         # defaults to 3001
WEB_URL=                      # CORS origin for the Vite dev server, and the base for absolute Discord links
POKE_SORT_DATA_DIR=           # where the database and scan captures live; defaults to ./.poke-sort
VECTORIZE_CONCURRENCY=        # parallel embed workers during a catalog sync; defaults to 4

# Public variables for the React app (baked into the client bundle at build time)
VITE_API_URL=                 # leave empty - the API is same-origin in both dev and the packaged app
VITE_APP_ENV=                 # local/developement/QA/production
```

The packaged desktop app sets `POKE_SORT_DATA_DIR` to Electron's `userData` directory and needs no configuration.

### Which data directory am I running?

Everything the app writes — database and scan captures — lives under one
`POKE_SORT_DATA_DIR`, and only the card catalog is global. Sorts, bins,
calibration, collections, scans and org settings are all **per directory**, so
two installs on one machine drift apart independently. "My calibration reset" is
almost always "I launched the other directory".

| Directory | Set by | Holds |
| --- | --- | --- |
| `packages/server/.poke-sort` | the default, when nothing sets the variable: `pnpm dev`, `pnpm test`, `db:generate`, `db:socket` | scratch. Created empty on demand; safe to delete |
| `packages/server/.poke-sort-catalog` | any unpackaged Electron run (`dev`, `dev:catalog`) and every `eval:*` script that needs a catalog | the full catalog and real calibration — the dev install |
| Electron `userData` | the packaged app, always | a real user's library |

One exception to "everything": the remembered serial device
(`serial-prefs.json`) is written to Electron's `userData` by every run, packaged
or not, so it is per machine rather than per data directory.

`resolveDataDir()` in `packages/desktop/src/main.ts` ignores the variable when
`app.isPackaged`, so nothing in the environment can move a shipped user's
library out from under them. Unpackaged it defaults to the catalog directory
above — resolved from `__dirname`, so it does not depend on where the launcher
was invoked, and no shell variable is involved (`export VAR=...` in a package
script would not run on Windows). An explicit `POKE_SORT_DATA_DIR` still
overrides it, from the environment rather than from `.env`, which neither
Electron nor the desktop `dev` script reads.

`dev` and `dev:catalog` are therefore the same command; the alias is kept only
for muscle memory.

PGlite allows one process per directory, so anything that opens the dev install
needs the app closed first: `eval:accuracy`, `eval:build`, `eval:capture`,
`eval:hnsw` and `calibration` all default to it now.

The browser dev flow (`pnpm dev`, Vite plus Hono on :3001) deliberately keeps
the default scratch directory rather than sharing the catalog: PGlite allows one
process per directory, and the Electron shell forks a server of its own. Root
`pnpm dev` is `turbo dev --filter='!@poke-sort/desktop'` for that reason —
unfiltered, `turbo dev` also runs the desktop `dev` script, which would boot a
second server against the catalog (and a nested `turbo build`) behind a command
documented as the browser flow.

Calibration is worth keeping outside a database, since it describes physical
hardware — see `collins-machine.json` and `pnpm --filter @poke-sort/server
calibration export|template|import`.

#### Bringing a second install back in sync

Two installs of one machine should not disagree about where its servos travel.
The committed document is the source of truth; push it into the other install
rather than re-tuning by hand (app closed — PGlite allows one process per
directory):

```bash
POKE_SORT_DATA_DIR="$HOME/Library/Application Support/PokeSort" \
  pnpm --filter @poke-sort/server calibration import ../../collins-machine.json
```

If boot logs `[db] Migration ... was not applied`, that install's migration
history has a hole — usually from migrating it against a half-merged journal, and
permanent, because the migrator only applies migrations newer than the newest one
already recorded. On a scratch install the fix is to delete its `db` directory and
let it rebuild; the rest of `userData` (window state, remembered serial device)
must be left alone. On an install holding real data, repair it rather than delete
it.

## Database

The database is an embedded PGlite instance under `POKE_SORT_DATA_DIR`. Migrations and
the game/settings seed run automatically on boot — there is no separate migrate step.

```bash
pnpm --filter @poke-sort/server db:generate  # generate a migration from schema changes
pnpm --filter @poke-sort/server db:socket    # expose the embedded db on :5432
pnpm --filter @poke-sort/server db:studio    # open Drizzle Studio (needs db:socket running)
```

All three follow `POKE_SORT_DATA_DIR`, so point it at the install you mean to
inspect — `POKE_SORT_DATA_DIR=./.poke-sort-catalog pnpm db:socket` for the dev
install. Without it they open the scratch directory, and Drizzle Studio then
shows an empty database that looks like data loss.

Because PGlite is single-process, the server must be stopped before any script
that opens the same data directory.

## Desktop app

```bash
pnpm --filter @poke-sort/desktop dev         # build everything and open the app
pnpm --filter @poke-sort/desktop fetch:model # SigLIP weights into .models (~100 MB)
pnpm --filter @poke-sort/desktop icons       # regenerate build/ icons from icon/
pnpm --filter @poke-sort/desktop dist        # installer in packages/desktop/release
```

The SigLIP weights are bundled rather than downloaded, so a fresh install never
needs the network to scan; `dist` fails with a pointed message if `.models` is
missing. It runs `pnpm deploy` to flatten the server's dependency tree — a plain
copy of pnpm's symlinked `node_modules` produces an app that cannot resolve its
native modules —
and then `scripts/prune-bundle.mjs`, which drops onnxruntime binaries for other
platforms, the unused browser ONNX backend, source maps and type packages
(~490 MB down to ~155 MB). The pruner assumes the build host matches the build
target; set `PRUNE_PLATFORM` / `PRUNE_ARCH` to cross-build.

It finishes by deleting links that would not survive being copied into the app —
ones whose target it just removed, and one `pnpm deploy` leaves pointing back at
`packages/server` from inside the bundle. `bundle-server.mjs` then refuses to
continue if any link still escapes the bundle. That check is not paranoia:
electron-builder re-creates every symlink verbatim from `readlink()`, so such a
link packages into an installer that builds, uploads and installs perfectly and
then dies on the user's first `require()`. It also catches the Windows case,
where pnpm uses junctions and `readlink()` returns an absolute path into the
build machine's checkout.

### Releasing

Two phases, because `dev` takes changes by pull request only.

```bash
pnpm release:minor    # or release:patch / release:major
```

Cuts `release/vX.Y.Z` from `origin/dev`, bumps all five `package.json`s, writes
a `CHANGELOG.md` entry from the commits since the last `v*` tag, and opens a PR.
It tags nothing. All five versions must move in lockstep:
`packages/web/vite.config.ts` reads the *root* version into `__APP_VERSION__`
for the footer, while electron-builder reads `packages/desktop` to stamp the
installer.

Merge that PR, then:

```bash
git checkout dev && git pull
pnpm release:tag
```

which tags the merge commit and pushes **only** the tag. The phases are separate
because the workflow checks out the tag, so the tag has to point at the commit
that actually carries the new version — and under a squash merge that commit
does not exist until GitHub creates it. (`release:tag` refuses if you are not on
`dev`, if `dev` is behind the remote, if the tag exists, or if the changelog has
no entry for the current version — that last one catches running it before the
PR merged.)

Add `--dry-run` to the first phase to see the plan without writing, branching or
opening anything.

The tag triggers `.github/workflows/release.yml`, which packages on macOS,
Windows and Linux in parallel, then collects the artifacts in a single job and
opens a **draft** release. Drafting is deliberate — smoke-test the installers
first, and the in-app update check reads `/releases/latest`, which ignores
drafts. Publish with:

```bash
gh release edit vX.Y.Z -R cmakohon/poke-sort --draft=false --latest
```

The `-R` is not optional in a fresh shell: `gh` has no default repo configured
here and fails with *"no default remote repository has been set"*. Set it once
with `gh repo set-default cmakohon/poke-sort` if you would rather not pass it.

There is no auto-updater. electron-updater hands macOS updates to Squirrel.Mac,
which validates that the update's code signature matches the running app's; on
an ad-hoc signed build every update would fail after downloading. Instead the
shell checks `/releases/latest` once per launch and offers to open the release
page (`packages/desktop/src/update-check.ts`).

Inside the app the Hono server runs in an Electron `utilityProcess` on a random
loopback port and serves the SPA itself, so the API is same-origin. There is no
separate server to start — `dev` and `dist` both bundle it.

The **packaged** app keeps its database in Electron's `userData` directory
(`~/Library/Application Support/PokeSort` on macOS). Unpackaged runs set the app
name explicitly too, so whatever still lands in `userData` — the remembered
serial device, Electron's own state — goes to `PokeSort` rather than to the
`Electron` directory that every unpackaged Electron app on the machine shares.

An unpackaged run keeps its **database** somewhere else: `resolveDataDir()`
defaults to `packages/server/.poke-sort-catalog`, so a dev run develops against
the full catalog rather than against a user's library (see "Which data directory
am I running?"). The default lives in `main.ts` rather than in the `dev` script
so it holds however Electron was launched, and on Windows too. `dev:catalog` is a
kept alias for `dev` and does the same thing.

An explicit value overrides that default, and takes any path:

```bash
POKE_SORT_DATA_DIR=/some/other/dir pnpm --filter @poke-sort/desktop dev
POKE_SORT_DATA_DIR="$HOME/Library/Application Support/PokeSort" \
  pnpm --filter @poke-sort/desktop dev   # the packaged app's own library
```

The resolved absolute path is logged on boot, and a path with no database in it
warns rather than quietly coming up with a catalog of zero cards.

A packaged app ignores the variable entirely: it owns `userData`, and an
environment variable should not be able to move a user's library out from under
them.

Note that the data directory is per-database, not shared — a run against the
catalog and a run against the default location see different collections, bins
and scan history.

On first launch the app adopts a data directory left behind by the upstream
name (`Mault`) if one exists and it has not been launched under the new name
yet, so an existing install keeps its database, captures and imported catalog.

### Catalog

Embedding the whole Pokémon catalog takes hours of CPU, so the maintainer builds
an embedding pack once and ships it as a release asset. The app downloads and
imports it on first run, which takes a couple of minutes.

The pack hangs off its own tag rather than `releases/latest`, because it changes
only when the catalog or the embedding pipeline does — pinning it to `latest`
would mean re-uploading 66 MB with every app release, and the first release that
forgot would 404 every new install. Close the app first; PGlite allows one
process per data directory:

```bash
pnpm --filter @poke-sort/server export:pack pokemon en ./pokemon-en.pack.gz
gh release create catalog-v3 ./pokemon-en.pack.gz --latest=false \
  --title "Card catalog pack v3"
```

`--latest=false` matters: the in-app update check reads `/releases/latest`, and a
data asset must not present itself as an app release.

The tag tracks `PACK_VERSION` and `EMBEDDING_IDENTITY`, not the app version.
`importPack` refuses a pack built by a different pipeline, so bumping
`PREPROCESSING_VERSION` means cutting `catalog-v4` and updating
`DEFAULT_TEMPLATE` in `packages/server/src/lib/pack/fetch-job.ts`.

Import is `POST /api/admin/catalog/import` (`{gameKey, lang, url?}`), polled via
`GET` on the same path; `url` may be a local path so a pack can be verified
before publishing. Falling back to a live catalog sync works but is slow and
depends on the image CDN staying friendly.

#### When a new set releases

The maintainer re-cuts the pack; everyone else re-imports it. The full sync is
"multi-hour" only for an empty catalog — `sync-job.ts` loads the existing card
ids first and skips them, so an established catalog only embeds the new set's
few hundred cards.

```bash
# 1. Pull and embed only what is new. In the app: Card database -> Sync,
#    or against the dev catalog directly. Close the app first.
POKE_SORT_DATA_DIR=./.poke-sort-catalog pnpm --filter @poke-sort/server dev

# 2. Refresh the series mapping. A card's embedded `set` object does not say
#    which series it belongs to and the id cannot be relied on to imply it,
#    so the mapping is fetched and committed.
pnpm --filter @poke-sort/server build:set-index

# 3. Re-export and replace the asset in place. Same tag: the tag tracks the
#    embedding pipeline, not the card count, and nothing about a new set
#    invalidates an existing pack's vectors.
pnpm --filter @poke-sort/server export:pack pokemon en ./pokemon-en.pack.gz
gh release upload catalog-v3 ./pokemon-en.pack.gz --clobber -R cmakohon/poke-sort
```

Commit the regenerated `packages/server/src/data/pokemon-set-index.json`.

Users pick it up from **Card database** in the sidebar: the panel reads the live
card count and its button says *Import* on an empty catalog and *Re-import* on a
populated one, so the same control pulls the refreshed pack. No app update is
needed — the pack URL is fixed, so an existing install downloads the new asset
from the same address. A fresh install is prompted automatically; an established
one is not, because there is no version stamped on an imported pack to compare
against (see the note on `onConflictDoNothing` below).

Cut a **new** tag (`catalog-v4`, and update `DEFAULT_TEMPLATE`) only when
`PREPROCESSING_VERSION` or `EMBEDDING_IDENTITY` changes — that is the one thing
that makes every published pack unimportable, and `importPack` will refuse the
old one rather than corrupt anything.

One limit worth knowing: `importPack` inserts with `onConflictDoNothing`, so a
re-import **adds** cards it has not seen and never **updates** ones it has. New
sets are all new rows, so this is the right trade — but a correction to an
existing card's data will not propagate to installs that already have it.

## Calibration

Servo positions, feeder timings and the camera's scan region describe one
physical machine, and are the only thing here that cannot be recomputed — the
catalog comes from upstream and collections can be rescanned. They live in
`module_configs`, `feeder_configs` and `org_settings`, and can be moved as a
single JSON document.

The Calibrate screen has **Export settings** / **Import settings** buttons that
write and read that document without closing anything, which is the way to copy
values between a `pnpm dev` install and the packaged one. Import shows what the
file will change before applying it.

The same document, from a shell:

```bash
cd packages/server
pnpm calibration export   ./calibration.json   # this machine -> file
pnpm calibration template ./calibration.json   # same, annotated, for filling in by hand
pnpm calibration import   ./calibration.json   # file -> this machine
```

Close the app first for the CLI: PGlite allows one process per data directory.
Target a specific install with `POKE_SORT_DATA_DIR`, e.g.
`"$HOME/Library/Application Support/PokeSort"`. The buttons above have no such
constraint — they go through the running server, as `GET`/`POST
/api/calibration`.

Servo values are PCA9685 pulse counts, not degrees: the firmware clamps every
write with `constrain(pulse, 120, 490)`, and export clamps to the same range so
a file always describes what the hardware will actually do. An import runs in
one transaction and records every change in the calibration history, so it can
be reverted like a manual edit. Sections omitted from a file are left untouched
rather than reset.

The scan region is four corners (`scanCorners`), each an x/y fraction of the
camera frame, labelled as the card sees them rather than as the frame does — the
camera is mounted sideways. The camera also looks at the platform from an angle,
so a card's outline in the frame is a trapezoid; free corners can follow that,
and the capture is straightened with a perspective warp on the way out. The
older `coverage`/`offset`/`rotation` rectangle is still read as a fallback, so
an install that has never opened the corner editor, and every calibration file
written before corners existed, keeps working unchanged.

## Hardware

The full bill of materials, wiring diagrams, and assembly instructions are in the
[upstream project's build guide](https://github.com/dishwasher-detergent/mault) —
this fork ships only the app. In short:

- Arduino Uno R4 Minima, driving a PCA9685 servo controller over I2C
- 9 positional SG90 servos (3 per module: trapdoor, paddle gate, pusher) plus 1 continuous-rotation SG90 for the feeder
- IR sensor for card-feed detection
- Enclosure and module parts are in `3d model/` (Fusion 360 source + printable `.3mf`)

Upload `arduino/main/main.ino` (requires the ArduinoJson library). It communicates via JSON over USB serial: the web app sends `{"bin": N}` and the Arduino runs the routing sequence.

## Webcam

Using a Logitech C920, these settings worked best:

Auto Focus: Off
Focus: 50%
Auto Exposure: On
Low Light Compensation: On
Auto White Balance: On
Brightness: 140
Contrast: 140
Saturation: 160
Sharpness: 130

## Licensing

This repository contains multiple components with different licenses, both
inherited from the upstream project and unchanged by this fork.

| Component               | License         |
| ----------------------- | --------------- |
| Software source code    | MIT License     |
| 3D models (`/3d model`) | CC BY-NC-SA 4.0 |

The MIT copyright line names Kenneth Bass, the original author, and stays that
way. See the `LICENSE` file in each directory for the complete license terms.
