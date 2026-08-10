# Magic Vault

A TCG card scanner and physical sorter. A webcam identifies cards via AI image embeddings, a rule engine decides which bin each card belongs in, and an Arduino-driven feeder and servo mechanism physically routes the card there.

## MakerWorld

https://makerworld.com/en/models/3066180-tcg-card-sorting-machine#profileId-3451252

## How it works

1. A feeder mechanism (continuous-rotation servo + roller) pulls a card from the hopper into view of the webcam, into a fixed, per-camera-calibrated scan region (see calibration screen)
2. The browser crops that region to a straightened card image (plain Canvas 2D, no computer vision needed, since the camera mounting and card size are fixed and calibrated ahead of time)
3. The image is sent to the server for embedding search (Hugging Face SigLIP)
4. Vector similarity search (pgvector, in an embedded PGlite database) identifies the card
5. Configurable, per-collection bin rules decide which bin the card should go to
6. The web app sends a serial command to the Arduino, which drives the trapdoor/paddle/pusher servos to route the card into that bin

## Features

- Live webcam scanning with automatic card detection and identification; captures wait for the card to physically settle at the sensor before the shot is taken
- Multi-TCG support: pluggable card-search adapters per game (Pokémon via TCGdex and Magic via Scryfall), with each game's own admin-configurable field definitions driving sorting, filtering, and bin rules
- Rule-based sort bins, grouped by collection, with and/or rule trees across each game's own card fields (color, rarity, price, set, etc.)
- Card grid sorting (by name, price, rarity, etc.) adapts automatically to whichever game a collection uses
- Multiple collections, each with their own bin configuration and card history
- Remote monitoring: watch an in-progress scan session live from another device
- Discord notifications for sorter errors/jams, plus an optional per-card-scanned notification with the card's image, name, price, collection/game, and a link to watch the session live
- Branding and scanner layout settings
- Feeder, servo, and camera scan-region calibration tools: the camera's capture region can be dragged/resized live against the feed to match different webcam mountings and fields of view
- In-app hardware build guide (`/build`) with bill of materials, wiring diagrams, and assembly instructions

## Stack

- **Web**: React 19, Vite, React Router v7, Tailwind CSS 4, TanStack Query
- **Desktop**: Electron 43 (Chromium is the only engine with Web Serial), packaged with electron-builder
- **Server**: Hono 4, Drizzle ORM, PGlite (embedded WASM Postgres) with pgvector + pg_trgm
- **Auth**: none — single local user, no accounts, no network storage
- **Hardware**: Arduino Uno R4 via Web Serial API (9600 baud), PCA9685 servo driver
- **Monorepo**: Turborepo + pnpm workspaces

## Project structure

```
packages/
├── shared/   @magic-vault/shared  - types, constants, evaluate-bin rule engine
├── server/   @magic-vault/server  - Hono API, Drizzle schema, embedded PGlite database
├── web/      @magic-vault/web     - React SPA (scanner, bins, collections, admin, build guide)
└── desktop/  @magic-vault/desktop - Electron shell: window, utilityProcess, Web Serial permissions
arduino/      Arduino sketch (arduino/main/main.ino)
"3d model"/   Printable enclosure/module design (Fusion 360 + .3mf)
drizzle/      Generated SQL migrations
scripts/      Release/version-bump helpers
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
MAULT_DATA_DIR=               # where the database and scan captures live; defaults to ./.mault
VECTORIZE_CONCURRENCY=        # parallel embed workers during a catalog sync; defaults to 4

# Public variables for the React app (baked into the client bundle at build time)
VITE_API_URL=                 # leave empty - the API is same-origin in both dev and the packaged app
VITE_APP_ENV=                 # local/developement/QA/production
```

The packaged desktop app sets `MAULT_DATA_DIR` to Electron's `userData` directory and needs no configuration.

## Database

The database is an embedded PGlite instance under `MAULT_DATA_DIR`. Migrations and
the game/settings seed run automatically on boot — there is no separate migrate step.

```bash
pnpm --filter @magic-vault/server db:generate  # generate a migration from schema changes
pnpm --filter @magic-vault/server db:socket    # expose the embedded db on :5432
pnpm --filter @magic-vault/server db:studio    # open Drizzle Studio (needs db:socket running)
```

Because PGlite is single-process, the server must be stopped before any script
that opens the same data directory.

## Desktop app

```bash
pnpm --filter @magic-vault/desktop dev    # build everything and open the app
pnpm --filter @magic-vault/desktop dist   # produce an installer in packages/desktop/release
```

`dist` fetches the SigLIP weights into `.models` if absent (~100 MB) and bundles
them, so a fresh install never needs the network to scan. It also runs
`pnpm deploy` to flatten the server's dependency tree — a plain copy of pnpm's
symlinked `node_modules` produces an app that cannot resolve its native modules —
and then `scripts/prune-bundle.mjs`, which drops onnxruntime binaries for other
platforms, the unused browser ONNX backend, source maps and type packages
(~436 MB down to ~102 MB). The pruner assumes the build host matches the build
target; set `PRUNE_PLATFORM` / `PRUNE_ARCH` to cross-build.

Inside the app the Hono server runs in an Electron `utilityProcess` on a random
loopback port and serves the SPA itself, so the API is same-origin.

### Catalog

Embedding all 23,444 Pokémon cards takes hours of CPU, so the maintainer builds
an embedding pack once and ships it as a release asset:

```bash
pnpm --filter @magic-vault/server export:pack -- pokemon en ./pokemon-en.pack.gz
```

Import it via `POST /api/admin/catalog/import-pack`. Falling back to a live
catalog sync works but is slow and depends on the image CDN staying friendly.

## Hardware

The full bill of materials, wiring diagrams, and assembly instructions live in the app at `/build`. In short:

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

This repository contains multiple components with different licenses.

| Component               | License         |
| ----------------------- | --------------- |
| Software source code    | MIT License     |
| 3D models (`/3d model`) | CC BY-NC-SA 4.0 |

See the `LICENSE` file in each directory for the complete license terms.
