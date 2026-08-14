# poke-sort — assistant notes

Pokémon card sorting machine. pnpm/turbo monorepo: `packages/desktop` (Electron
shell), `packages/server` (Hono + Drizzle + PGlite, serves the API and the built
SPA), `packages/web` (React renderer — all serial hardware I/O lives here),
`packages/shared` (types), `arduino/` (firmware).

## Database: PGlite is single-process

**Never open the database directory (or run scripts against it) while the app
is running.** A second opener corrupts the WAL. Close the app first, or go
through the running server's HTTP API instead — that is what the debug
endpoints below are for.

Corruption is silent: both processes appear healthy for as long as one holds
the database in memory, and the failure surfaces only on the **next cold
start**, as `PANIC: could not locate a valid checkpoint record`. So "it still
works" is not evidence that nothing was damaged.

### Before starting anything, check who has it

```
POKE_SORT_DATA_DIR=./.poke-sort-catalog pnpm --filter @poke-sort/server db:status
```

Exit 0 means free; non-zero means occupied (or unverifiable) — either way, do
not start a second process. `packages/server/src/db/index.ts` runs the same
check at boot and refuses rather than corrupting, but do not rely on that alone:
it only protects processes running current code, and an app launched from an
older build will still open the directory with no lock file and no complaint.

**`pgrep`/`pkill` patterns are not a verification.** A pattern that matches
nothing looks identical to a process that stopped, and using the same wrong
pattern to check the kill makes it confirm its own failure — that is how the
first corruption happened. The kernel's answer is the only one that counts:

```
lsof +D packages/server/.poke-sort-catalog/db
```

Note that **lsof exits 1 even when it does find holders**, so check its output,
not its exit code.

### If it does get corrupted

`pg_resetwal -f <dataDir>/db` (Homebrew Postgres, major version matching
`PG_VERSION`) has recovered it fully both times. Copy the directory first.

## Diagnosing issues: query the running app

The server writes its port to `<dataDir>/server.port` on boot (dev data dir:
`packages/server/.poke-sort`, or wherever `POKE_SORT_DATA_DIR` points; packaged:
`~/Library/Application Support/poke-sort`). Dev default port is 3001.

- `GET /api/machine-events?since=&until=&type=&session=&limit=` — serial
  telemetry: every command/response exchange (with `outcome` ok / timeout /
  write_failed / reset and `latency_ms`) plus lifecycle events (`port_opened`,
  `port_open_failed`, `connect_failed`, `ready`, `boot_test_pass/fail`,
  `reboot_detected`, `unplug`, `stream_ended`, `read_error`, `queue_reset`,
  `disconnect`, `rx_unsolicited`, `rx_non_json`, `log_overflow`). `since` and
  `until` take ISO strings or epoch milliseconds.
- `GET /api/debug/scan-events?tier=&since=&corrected=1&full=1&limit=` — one
  row per identify attempt (all tiers, no-match included) with score, margin,
  OCR reading, top-10 candidates + per-signal scores (`full=1`), and a saved
  capture at `GET /api/captures/se-<guid>.jpeg`.
- `POST /api/debug/sql` with `{"sql": "select ..."}` — read-only ad-hoc SQL
  (single statement, enforced by a READ ONLY transaction). Results cap at
  1000 rows (`truncatedAt` in the response when hit). **PGlite cannot cancel
  a running query and executes on the main thread** — a heavy query blocks
  the entire process (even the endpoint's own 10s timeout) until it finishes,
  so keep debug queries small and never run heavy ones while the machine is
  actively sorting.

Useful queries:

```sql
-- Everything around the last disconnect-ish event
select * from machine_events
where ts > (select max(ts) from machine_events
            where event_type in ('unplug','stream_ended','reboot_detected'))
           - interval '2 minutes'
order by ts, seq;

-- Corrections = labelled eval data (predicted vs actual)
select guid, tier, score, margin, corrected_card_id, candidates->0 as predicted
from scan_events where corrected_card_id is not null;
```

`collection_cards.scan_event_guid` joins a saved card to its `scan_events`
diagnostics row. Retention: machine_events 14 days; scan_events 180 days;
accept-tier capture images 30 days; corrected rows are kept forever.

## Migrations

`pnpm --filter @poke-sort/server db:generate`, then hand-edit the SQL (prose
why-comment, `IF NOT EXISTS`) and the journal. **The `when` value in
`drizzle/meta/_journal.json` is hand-maintained** (1786500000000 + 60000 per
migration) and must strictly exceed every existing `when` on every branch — a
tie is silently skipped (post-mortem in `drizzle/0008_review_bin.sql`). Check
boot logs for the skipped-migration warning after the first run.
