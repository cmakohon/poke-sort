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

This fork exists because the machine on my desk sorts Pokémon, and mault was
built as a hosted multi-tenant web app spanning several games. Rather than
maintain a general tool badly, this fork narrows the scope hard and specialises.

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
POKE_SORT_DATA_DIR=           # where the database and scan captures live; defaults to ./.poke-sort
VECTORIZE_CONCURRENCY=        # parallel embed workers during a catalog sync; defaults to 4

# Public variables for the React app (baked into the client bundle at build time)
VITE_API_URL=                 # leave empty - the API is same-origin in both dev and the packaged app
VITE_APP_ENV=                 # local/developement/QA/production
```

The packaged desktop app sets `POKE_SORT_DATA_DIR` to Electron's `userData` directory and needs no configuration.

## Database

The database is an embedded PGlite instance under `POKE_SORT_DATA_DIR`. Migrations and
the game/settings seed run automatically on boot — there is no separate migrate step.

```bash
pnpm --filter @poke-sort/server db:generate  # generate a migration from schema changes
pnpm --filter @poke-sort/server db:socket    # expose the embedded db on :5432
pnpm --filter @poke-sort/server db:studio    # open Drizzle Studio (needs db:socket running)
```

Because PGlite is single-process, the server must be stopped before any script
that opens the same data directory.

## Desktop app

```bash
pnpm --filter @poke-sort/desktop dev    # build everything and open the app
pnpm --filter @poke-sort/desktop dist   # produce an installer in packages/desktop/release
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
loopback port and serves the SPA itself, so the API is same-origin. There is no
separate server to start — `dev` and `dist` both bundle it.

The app keeps its database in Electron's `userData` directory
(`~/Library/Application Support/PokeSort` on macOS). Unpackaged runs set the app
name explicitly so they land there too, rather than in the `Electron` directory
that every unpackaged Electron app on the machine shares.

An unpackaged run can point somewhere else, which is how to develop against a
full catalog rather than whichever database the default location happens to
hold:

```bash
pnpm --filter @poke-sort/desktop dev:catalog   # uses packages/server/.poke-sort-catalog
```

That is a thin wrapper over `POKE_SORT_DATA_DIR`, which takes any path:

```bash
POKE_SORT_DATA_DIR=/some/other/dir pnpm --filter @poke-sort/desktop dev
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

Embedding all 23,444 Pokémon cards takes hours of CPU, so the maintainer builds
an embedding pack once and ships it as a release asset:

```bash
pnpm --filter @poke-sort/server export:pack -- pokemon en ./pokemon-en.pack.gz
```

Import it via `POST /api/admin/catalog/import-pack`. Falling back to a live
catalog sync works but is slow and depends on the image CDN staying friendly.

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
