import type { Dirent } from "node:fs";
import { opendir, readdir, stat, statfs } from "node:fs/promises";
import path from "node:path";
import {
  type DataUsageCategory,
  type DataUsageCategoryKey,
  type DataUsageSnapshot,
  TRIM_AGE_DAYS,
  type TrimAge,
} from "@poke-sort/shared";
import { sql } from "drizzle-orm";
import { CAPTURES_DIR, DATA_DIR, DB_DIR, MODEL_DIR } from "../config";
import { db } from "../db";

/**
 * How much disk the app is using, broken down into things a user recognises.
 *
 * Two constraints shape all of this. PGlite runs on the main thread and cannot
 * cancel a query, so a heavy measurement stalls scanning — every SQL statement
 * here reads catalog metadata or an index, never a heap. And `fs.stat` runs on
 * the libuv threadpool, so the directory walks cost wall-clock but do not block
 * the database; the cache below exists to keep even that off the hot path.
 *
 * The numbers are allocated blocks, not apparent size, so they match `du` and
 * Finder. Anyone checking this screen against the shell should get the same
 * answer, or the screen is not worth having.
 */

const SNAPSHOT_TTL_MS = 60_000;
/** A held-down refresh button must not be able to re-run the walk. */
const MIN_FORCED_REFRESH_MS = 5_000;
/** Enough parallel stats to saturate an SSD, few enough to not exhaust the pool. */
const STAT_CONCURRENCY = 32;
const SLOW_WALK_MS = 1_500;

/** Tables that roll up into a user-visible category. Everything else is overhead. */
const RELATION_CATEGORY: Record<string, DataUsageCategoryKey> = {
  cards: "catalog",
  games: "catalog",
  collection_cards: "collection",
  collections: "collection",
  scan_sessions: "collection",
  scan_events: "scanDiagnostics",
  machine_events: "machineTelemetry",
  bin_set_audit: "configHistory",
  module_config_audit: "configHistory",
  feeder_config_audit: "configHistory",
};

interface RelationRow {
  relname: string;
  total_bytes: number;
  dead_bytes: number;
}

interface Counts {
  catalog_cards: number;
  collection_cards: number;
  machine_events: number;
  scan_events: number;
  scan_events_protected: number;
  scan_captures: number;
  config_audits: number;
  [bucket: string]: number;
}

interface DirMeasure {
  bytes: number;
  files: number;
}

// ─── Filesystem ──────────────────────────────────────────────────────────────

/**
 * Allocated size. `blocks` is populated on darwin and linux; the `size`
 * fallback keeps this honest-ish anywhere else rather than reporting zero.
 */
function allocatedSize(info: { blocks: number; size: number }): number {
  return info.blocks > 0 ? info.blocks * 512 : info.size;
}

/** Runs `worker` over `items` with a fixed number in flight. */
async function pooled<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(STAT_CONCURRENCY, items.length) },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        await worker(item);
      }
    },
  );
  await Promise.all(runners);
}

/**
 * Measures a flat directory, optionally splitting it in two.
 *
 * `opendir` streams entries instead of building one array of every file name,
 * which matters here: the captures directory grows by one file per scan and
 * there is no ceiling on it. Names are collected (cheap strings) and the stats
 * run pooled afterwards.
 */
async function measureFlatDir(
  dir: string,
  splitOn?: (name: string) => boolean,
): Promise<{ all: DirMeasure; matched: DirMeasure; rest: DirMeasure }> {
  const names: string[] = [];
  try {
    const handle = await opendir(dir);
    for await (const entry of handle) {
      if (entry.isFile()) names.push(entry.name);
    }
  } catch {
    // No directory yet — a fresh install has scanned nothing.
    const empty = { bytes: 0, files: 0 };
    return { all: empty, matched: { ...empty }, rest: { ...empty } };
  }

  const matched: DirMeasure = { bytes: 0, files: 0 };
  const rest: DirMeasure = { bytes: 0, files: 0 };
  await pooled(names, async (name) => {
    let bytes: number;
    try {
      bytes = allocatedSize(await stat(path.join(dir, name)));
    } catch {
      // Unlinked mid-walk. Normal while the machine is running, not an error.
      return;
    }
    const bucket = splitOn?.(name) ? matched : rest;
    bucket.bytes += bytes;
    bucket.files += 1;
  });
  return {
    all: { bytes: matched.bytes + rest.bytes, files: matched.files + rest.files },
    matched,
    rest,
  };
}

/** Recursive walk, for the Postgres cluster and the model cache. */
async function measureTree(dir: string): Promise<DirMeasure> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    return { bytes: 0, files: 0 };
  }
  const files = entries.filter((e) => e.isFile());
  const measure: DirMeasure = { bytes: 0, files: 0 };
  await pooled(files, async (entry) => {
    let bytes: number;
    try {
      bytes = allocatedSize(await stat(path.join(entry.parentPath, entry.name)));
    } catch {
      // Postgres recycles WAL segments constantly; a vanished one is expected.
      return;
    }
    // Accumulated after the await, never across it: `measure.bytes += await …`
    // reads the running total before suspending and writes it back after, so
    // with 32 stats in flight every concurrent add but the last is lost. It
    // under-reports silently, which on this screen reads as "the database is
    // smaller than it is".
    measure.bytes += bytes;
    measure.files += 1;
  });
  return measure;
}

/**
 * Everything directly under DATA_DIR that is not the database or the captures:
 * a leftover pack download, the port file, the lock file.
 */
async function measureOtherFiles(): Promise<DirMeasure> {
  let entries: Dirent[];
  try {
    entries = await readdir(DATA_DIR, { withFileTypes: true });
  } catch {
    return { bytes: 0, files: 0 };
  }
  const measure: DirMeasure = { bytes: 0, files: 0 };
  for (const entry of entries) {
    const full = path.join(DATA_DIR, entry.name);
    if (full === DB_DIR || full === CAPTURES_DIR) continue;
    if (entry.isDirectory()) {
      const sub = await measureTree(full);
      measure.bytes += sub.bytes;
      measure.files += sub.files;
    } else if (entry.isFile()) {
      try {
        measure.bytes += allocatedSize(await stat(full));
        measure.files += 1;
      } catch {
        // Ignore; see measureFlatDir.
      }
    }
  }
  return measure;
}

/** The model never changes once the app is installed, so measure it once. */
let modelBytesCache: number | null | undefined;
async function measureModel(): Promise<number | null> {
  if (modelBytesCache !== undefined) return modelBytesCache;
  if (!MODEL_DIR) {
    modelBytesCache = null;
    return null;
  }
  const measure = await measureTree(MODEL_DIR);
  modelBytesCache = measure.files > 0 ? measure.bytes : null;
  return modelBytesCache;
}

// ─── Database ────────────────────────────────────────────────────────────────

/**
 * One catalog query for every table's size.
 *
 * pg_total_relation_size covers the heap, its TOAST (card_data, candidates)
 * and every index (the HNSW graph is most of the catalog's footprint), and
 * costs a stat per segment file rather than a scan. n_dead_tup times the
 * average row width estimates the space a delete left behind for reuse — an
 * estimate, and labelled as one everywhere it surfaces.
 */
async function relationSizes(): Promise<RelationRow[]> {
  const result = await db.execute(sql`
    select c.relname::text                      as relname,
           pg_total_relation_size(c.oid)::bigint as total_bytes,
           case when c.reltuples > 0
                then (coalesce(s.n_dead_tup, 0)
                      * (pg_relation_size(c.oid) / c.reltuples))::bigint
                else 0::bigint
           end                                   as dead_bytes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_stat_user_tables s on s.relid = c.oid
    where n.nspname = 'public' and c.relkind = 'r'
  `);
  return (result.rows as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      relname: String(r.relname),
      total_bytes: Number(r.total_bytes ?? 0),
      dead_bytes: Number(r.dead_bytes ?? 0),
    };
  });
}

/**
 * Every count the screen shows, plus every trim preview, in one statement.
 *
 * The cutoffs are computed here and bound as parameters rather than written as
 * SQL intervals, so the preview and the trim that follows it use the same
 * arithmetic — TRIM_AGE_DAYS — instead of two expressions that have to be kept
 * in agreement by hand. Protected rows are excluded from every preview: no
 * trim will delete them, and a preview that overstates what a button does is
 * worse than no preview at all.
 */
async function counts(): Promise<Counts> {
  const now = Date.now();
  const at = (age: Exclude<TrimAge, "all">) =>
    new Date(now - (TRIM_AGE_DAYS[age] as number) * 86_400_000);
  const bucket = (age: Exclude<TrimAge, "all">) => sql`${at(age)}`;
  const result = await db.execute(sql`
    select
      (select count(*) from cards)::int                                as catalog_cards,
      (select count(*) from collection_cards)::int                     as collection_cards,
      (select count(*) from machine_events)::int                       as machine_events,
      (select count(*) from machine_events
         where ts < ${bucket("1w")})::int             as machine_events_1w,
      (select count(*) from machine_events
         where ts < ${bucket("1m")})::int             as machine_events_1m,
      (select count(*) from machine_events
         where ts < ${bucket("3m")})::int             as machine_events_3m,
      (select count(*) from scan_events)::int                          as scan_events,
      (select count(*) from scan_events
         where reviewed_at is not null
            or corrected_card_id is not null)::int                     as scan_events_protected,
      (select count(*) from scan_events
         where capture_path is not null)::int                          as scan_captures,
      (select count(*) from scan_events
         where reviewed_at is null and corrected_card_id is null
           and created_at < ${bucket("1w")})::int      as scan_events_1w,
      (select count(*) from scan_events
         where reviewed_at is null and corrected_card_id is null
           and created_at < ${bucket("1m")})::int      as scan_events_1m,
      (select count(*) from scan_events
         where reviewed_at is null and corrected_card_id is null
           and created_at < ${bucket("3m")})::int      as scan_events_3m,
      (select count(*) from scan_events
         where reviewed_at is null and corrected_card_id is null)::int  as scan_events_all,
      (select count(*) from scan_events
         where capture_path is not null
           and reviewed_at is null and corrected_card_id is null
           and created_at < ${bucket("1w")})::int      as scan_captures_1w,
      (select count(*) from scan_events
         where capture_path is not null
           and reviewed_at is null and corrected_card_id is null
           and created_at < ${bucket("1m")})::int      as scan_captures_1m,
      (select count(*) from scan_events
         where capture_path is not null
           and reviewed_at is null and corrected_card_id is null
           and created_at < ${bucket("3m")})::int      as scan_captures_3m,
      (select count(*) from scan_events
         where capture_path is not null
           and reviewed_at is null and corrected_card_id is null)::int  as scan_captures_all,
      (select count(*) from bin_set_audit)
        + (select count(*) from module_config_audit)
        + (select count(*) from feeder_config_audit)                    as config_audits,
      (select count(*) from bin_set_audit where created_at < ${bucket("1w")})
        + (select count(*) from module_config_audit where created_at < ${bucket("1w")})
        + (select count(*) from feeder_config_audit where created_at < ${bucket("1w")})
                                                                        as config_audits_1w,
      (select count(*) from bin_set_audit where created_at < ${bucket("1m")})
        + (select count(*) from module_config_audit where created_at < ${bucket("1m")})
        + (select count(*) from feeder_config_audit where created_at < ${bucket("1m")})
                                                                        as config_audits_1m,
      (select count(*) from bin_set_audit where created_at < ${bucket("3m")})
        + (select count(*) from module_config_audit where created_at < ${bucket("3m")})
        + (select count(*) from feeder_config_audit where created_at < ${bucket("3m")})
                                                                        as config_audits_3m
  `);
  const row = (result.rows[0] ?? {}) as Record<string, unknown>;
  const out = {} as Counts;
  for (const [key, value] of Object.entries(row)) out[key] = Number(value ?? 0);
  return out;
}

// ─── Assembly ────────────────────────────────────────────────────────────────

function preview(
  c: Counts,
  prefix: string,
  allKey?: string,
): Record<TrimAge, number> {
  return {
    "1w": c[`${prefix}_1w`] ?? 0,
    "1m": c[`${prefix}_1m`] ?? 0,
    "3m": c[`${prefix}_3m`] ?? 0,
    all: c[allKey ?? prefix] ?? 0,
  };
}

async function measure(): Promise<DataUsageSnapshot> {
  const startedAt = Date.now();
  const warnings: string[] = [];

  /** One failed measurement must cost its own numbers, never the whole screen. */
  async function attempt<T>(name: string, run: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await run();
    } catch (err) {
      console.warn(`[data-usage] ${name} failed:`, err);
      warnings.push(name);
      return fallback;
    }
  }

  const [relations, c, captures, dbTree, otherFiles, modelBytes, disk] = await Promise.all([
    attempt("relations", relationSizes, [] as RelationRow[]),
    attempt("counts", counts, {} as Counts),
    attempt(
      "captures",
      () => measureFlatDir(CAPTURES_DIR, (name) => name.startsWith("se-")),
      {
        all: { bytes: 0, files: 0 },
        matched: { bytes: 0, files: 0 },
        rest: { bytes: 0, files: 0 },
      },
    ),
    attempt("database", () => measureTree(DB_DIR), { bytes: 0, files: 0 }),
    attempt("otherFiles", measureOtherFiles, { bytes: 0, files: 0 }),
    attempt("model", measureModel, null as number | null),
    attempt(
      "disk",
      async () => {
        const fs = await statfs(DATA_DIR);
        return {
          free: Number(fs.bsize) * Number(fs.bavail),
          total: Number(fs.bsize) * Number(fs.blocks),
        };
      },
      null as { free: number; total: number } | null,
    ),
  ]);

  const relationBytes = new Map<DataUsageCategoryKey, number>();
  const deadBytes = new Map<DataUsageCategoryKey, number>();
  let attributed = 0;
  for (const row of relations) {
    const key = RELATION_CATEGORY[row.relname];
    if (!key) continue;
    relationBytes.set(key, (relationBytes.get(key) ?? 0) + row.total_bytes);
    deadBytes.set(key, (deadBytes.get(key) ?? 0) + row.dead_bytes);
    attributed += row.total_bytes;
  }
  // Clamped at zero because the two measurements are taken microseconds apart
  // against a live cluster; a checkpoint in between must not produce a negative
  // segment. `null` when the stats view gave us nothing to report.
  const statsAvailable = relations.length > 0 && !warnings.includes("relations");
  const reusable = (key: DataUsageCategoryKey) =>
    statsAvailable ? Math.max(0, deadBytes.get(key) ?? 0) : null;
  const relationSize = (key: DataUsageCategoryKey) => relationBytes.get(key) ?? 0;

  const categories: DataUsageCategory[] = [
    {
      key: "catalog",
      bytes: relationSize("catalog"),
      count: c.catalog_cards ?? 0,
      countUnit: "cards",
      reusableBytes: reusable("catalog"),
      trimmable: false,
    },
    {
      key: "collection",
      // The card images the detail panel renders live in the same directory as
      // the diagnostics captures; only the `se-` prefix tells them apart.
      bytes: relationSize("collection") + captures.rest.bytes,
      count: c.collection_cards ?? 0,
      countUnit: "cards",
      reusableBytes: reusable("collection"),
      trimmable: false,
    },
    {
      key: "scanCaptures",
      bytes: captures.matched.bytes,
      count: captures.matched.files,
      countUnit: "images",
      reusableBytes: null,
      trimmable: true,
      protectedCount: c.scan_events_protected ?? 0,
      trimPreview: preview(c, "scan_captures", "scan_captures_all"),
    },
    {
      key: "scanDiagnostics",
      bytes: relationSize("scanDiagnostics"),
      count: c.scan_events ?? 0,
      countUnit: "scans",
      reusableBytes: reusable("scanDiagnostics"),
      trimmable: true,
      protectedCount: c.scan_events_protected ?? 0,
      trimPreview: preview(c, "scan_events", "scan_events_all"),
    },
    {
      key: "machineTelemetry",
      bytes: relationSize("machineTelemetry"),
      count: c.machine_events ?? 0,
      countUnit: "events",
      reusableBytes: reusable("machineTelemetry"),
      trimmable: true,
      trimPreview: preview(c, "machine_events"),
    },
    {
      key: "configHistory",
      bytes: relationSize("configHistory"),
      count: c.config_audits ?? 0,
      countUnit: "snapshots",
      reusableBytes: reusable("configHistory"),
      trimmable: true,
      trimPreview: preview(c, "config_audits"),
    },
    {
      key: "databaseOverhead",
      // The residual, by definition: the write-ahead log, the system catalogs,
      // free space inside the files, and the handful of small config tables
      // nobody wants a row for. Defining it this way is what makes the
      // segments sum to the total exactly.
      bytes: Math.max(0, dbTree.bytes - attributed),
      count: null,
      countUnit: null,
      reusableBytes: null,
      trimmable: false,
    },
    {
      key: "otherFiles",
      bytes: otherFiles.bytes,
      count: otherFiles.files,
      countUnit: "files",
      reusableBytes: null,
      trimmable: false,
    },
  ];

  const computeMs = Date.now() - startedAt;
  if (computeMs > SLOW_WALK_MS) {
    console.warn(
      `[data-usage] measurement took ${computeMs}ms (${captures.all.files} captures, ${dbTree.files} db files)`,
    );
  }

  return {
    // Summed from the segments rather than measured separately, so the bar and
    // the headline can never disagree.
    totalBytes: categories.reduce((sum, cat) => sum + cat.bytes, 0),
    categories,
    diskFreeBytes: disk?.free ?? null,
    diskTotalBytes: disk?.total ?? null,
    modelBytes,
    computedAt: new Date().toISOString(),
    computeMs,
    warnings,
  };
}

// ─── Cache ───────────────────────────────────────────────────────────────────

let cached: { at: number; snapshot: DataUsageSnapshot } | null = null;
let inFlight: Promise<DataUsageSnapshot> | null = null;

/**
 * Cached and single-flighted, because this is the one endpoint a user can
 * hammer: two open windows, or a refresh button held down, would otherwise
 * queue directory walks behind each other while the machine is sorting.
 */
export async function getDataUsage(opts?: { refresh?: boolean }): Promise<DataUsageSnapshot> {
  const now = Date.now();
  const age = cached ? now - cached.at : Infinity;
  const floor = opts?.refresh ? MIN_FORCED_REFRESH_MS : SNAPSHOT_TTL_MS;
  if (cached && age < floor) return cached.snapshot;
  if (inFlight) return inFlight;

  inFlight = measure()
    .then((snapshot) => {
      cached = { at: Date.now(), snapshot };
      return snapshot;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * Drops the cache outright. Called after a trim so the refetch that follows is
 * a real measurement rather than the pre-delete numbers the floor would
 * otherwise hand back.
 */
export function invalidateDataUsage(): void {
  cached = null;
}
