import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm/relations";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(768)"; // 768 dimensions — SigLIP base-patch16-512 embeddings
  },
  toDriver(value: number[]): string {
    return JSON.stringify(value);
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value);
  },
});

// ─── Global card vectors (no org scope) ──────────────────────────────────────

export const cardImageVectors = pgTable(
  "cards",
  {
    id: serial().primaryKey(),
    guid: uuid("guid").defaultRandom(),
    cardId: text("card_id").notNull(),
    gameKey: text("game_key").notNull().default("pokemon"),
    lang: text("lang").notNull().default("en"),
    name: text("name").notNull(),
    setCode: text("set_code").notNull(),
    embedding: vector("embedding").notNull(),
    // A second embedding of the ART WINDOW alone (lib/art-window.ts). The
    // whole-card vector is dominated by the frame, which is identical across a
    // set, so two printings of one Pokemon land ~0.02 apart — inside the margin
    // gate, and the largest single cause of HS-era misidentification. Blended
    // with `embedding` at rerank time it takes hgss top-1 74.2% -> 93.8%.
    //
    // Nullable: a catalog imported from a v3 pack has none, and a candidate
    // without one is scored on its whole-card distance alone.
    embeddingArt: vector("embedding_art"),
    // The printed collector number ("58") and the set's official count ("102").
    // Together they reconstruct "58/102" across every Pokemon era, which is the
    // single strongest disambiguator between the dozens of reprints that share
    // a name and look nearly identical to an image embedding.
    collectorNumber: text("collector_number"),
    setTotal: integer("set_total"),
    // The full upstream card object (the TCGdex card detail).
    //
    // Denormalised deliberately: re-ranking needs these fields for all ~50
    // candidates, and the bin rule engine resolves its `path`s against this
    // object (see getCardValue in evaluate-bin.ts). Fetching it per candidate
    // over the network would be both slow and, for a local-first app, wrong.
    cardData: jsonb("card_data"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("cards_card_id_idx").on(table.cardId),
    index("cards_game_lang_idx").on(table.gameKey, table.lang),
    index("cards_collector_number_idx").on(table.collectorNumber),
    // The correction search's trigram index is NOT declared here. It indexes an
    // expression — the folded name, see `folded` in lib/card-search/local.ts —
    // which drizzle's schema builder cannot express, so it lives in
    // drizzle/0020 alongside the DROP of the raw-column index it replaces.
    // Re-declaring the old one here would have drizzle recreate a dead index.
    //
    // It is required, not an optimisation: PGlite runs on the main thread and
    // cannot cancel a query, so a sequential scan of ~22k rows per debounced
    // keystroke would stall the process mid-sort.
    // Approximate nearest-neighbour index over the embeddings.
    //
    // Measured on the real 21,714-card catalog with degraded (low-quality)
    // probes: at hnsw.ef_search=100 it returns the same top-1 as an exact scan
    // for 60/60 probes, 100% recall@10 and 99.1% recall@50, at 2.9 ms against
    // the exact scan's 71 ms. Build takes ~35 s.
    //
    // The Phase 0 spike suggested the opposite, but it queried uniformly random
    // vectors where every point is near-equidistant — real embeddings cluster,
    // which is the structure HNSW exists to exploit.
    index("cards_embedding_hnsw")
      .using("hnsw", table.embedding.op("vector_cosine_ops")),
    // There is deliberately NO index on embedding_art. Retrieval stays
    // whole-card and the art vector only re-orders the 50 candidates it
    // returns — measured recall@50 on the 1068-capture labelled set is 100% on
    // every era, hgss included, so retrieval never loses the truth and there is
    // nothing for a second index to find. Building one would cost ~35 s and the
    // disk for a query that is never issued.
  ],
);

export const games = pgTable(
  "games",
  {
    id: serial().primaryKey(),
    guid: uuid("guid").defaultRandom(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    dataSourceUrl: text("data_source_url").notNull(),
    fieldDefinitions: jsonb("field_definitions").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("games_key_idx").on(table.key),
    unique("games_guid_idx").on(table.guid),
  ],
);

// ─── Org-scoped data tables ───────────────────────────────────────────────────

export const binSets = pgTable(
  "bin_sets",
  {
    id: serial().primaryKey(),
    guid: uuid("guid").defaultRandom(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    // No game_id: a sort describes how the machine is configured, not what it
    // is sorting. Exactly one is active at a time (see routes/bins.ts).
    orgId: text("org_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("bin_sets_guid_idx").on(table.guid),
  ],
);

export const bins = pgTable(
  "bins",
  {
    id: serial().primaryKey(),
    guid: uuid("guid").defaultRandom(),
    rules: jsonb("rules").notNull(),
    isCatchAll: boolean("is_catch_all").notNull().default(false),
    // The bin low-confidence scans are diverted to, at most one per set. Kept
    // apart from is_catch_all because "no rule claimed this" and "the pipeline
    // does not trust its answer" are different stacks to a human tuning
    // accuracy; false everywhere means review-tier scans fall back to the
    // catch-all, which is what every existing set does.
    isReviewBin: boolean("is_review_bin").notNull().default(false),
    binNumber: integer("bin_number").notNull(),
    binSet: integer("bin_set")
      .notNull()
      .references(() => binSets.id),
    orgId: text("org_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("bins_guid_idx").on(table.guid),
  ],
);

export const moduleConfigs = pgTable(
  "module_configs",
  {
    id: serial().primaryKey(),
    guid: uuid("guid").defaultRandom(),
    moduleNumber: integer("module_number").notNull(),
    orgId: text("org_id").notNull(),
    bottomClosed: integer("bottom_closed").notNull().default(102),
    bottomOpen: integer("bottom_open").notNull().default(307),
    paddleClosed: integer("paddle_closed").notNull().default(150),
    paddleOpen: integer("paddle_open").notNull().default(307),
    pusherLeft: integer("pusher_left").notNull().default(150),
    pusherNeutral: integer("pusher_neutral").notNull().default(307),
    pusherRight: integer("pusher_right").notNull().default(460),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("module_configs_org_module_idx").on(table.orgId, table.moduleNumber),
  ],
);

export const feederConfigs = pgTable(
  "feeder_configs",
  {
    id: serial().primaryKey(),
    guid: uuid("guid").defaultRandom(),
    orgId: text("org_id").notNull(),
    speed: integer("speed").notNull().default(400),
    duration: integer("duration").notNull().default(3000),
    pulseDuration: integer("pulse_duration").notNull().default(80),
    pauseDuration: integer("pause_duration").notNull().default(50),
    settleDuration: integer("settle_duration").notNull().default(150),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("feeder_configs_org_idx").on(table.orgId),
  ],
);

export const collections = pgTable(
  "collections",
  {
    id: serial().primaryKey(),
    guid: uuid("guid").defaultRandom(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    gameId: integer("game_id").references(() => games.id),
    lang: text("lang").notNull().default("en"),
    orgId: text("org_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("collections_guid_idx").on(table.guid),
  ],
);

/**
 * One run of the machine.
 *
 * Scanning used to insert straight into the active collection, so the scan
 * screen showed that collection's entire history and a throwaway test run
 * permanently polluted it. Cards now stage against a session and only acquire
 * a collection_id when the user saves; discarding deletes them. scan_events is
 * a separate table and is never touched by either path, so the diagnostics and
 * review data survive a discard — that is why staging lives in the database
 * rather than in client state.
 *
 * A session exists before its first card, because the target collection has to
 * supply the game key and language to the identify pipeline up front. That is
 * also why this is a table and not just a column on collection_cards.
 */
export const scanSessions = pgTable(
  "scan_sessions",
  {
    id: serial().primaryKey(),
    guid: uuid("guid").defaultRandom(),
    orgId: text("org_id").notNull(),
    // Where the run is aimed. SET NULL rather than CASCADE: deleting the
    // target collection must not take a run's staged cards with it (the cards
    // themselves are already immune — their collection_id is NULL, so the
    // cascade misses them).
    targetCollectionId: integer("target_collection_id").references(
      () => collections.id,
      { onDelete: "set null" },
    ),
    // What the run's cards were actually identified against, stamped from the
    // target when the first card is staged and frozen from then on.
    //
    // The target alone cannot answer this: switching collections mid-run
    // re-points it, so by save time it may name a different game entirely
    // while the staged cards still came from the original catalog. This is
    // what the save dialog's mismatch warning compares against.
    identifiedGameKey: text("identified_game_key"),
    identifiedLang: text("identified_lang"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    // NULL means open. Closing stamps the outcome; saved runs also record
    // where they landed, which is not necessarily the target.
    closedAt: timestamp("closed_at"),
    outcome: text("outcome"), // 'saved' | 'discarded'
    savedCollectionId: integer("saved_collection_id").references(
      () => collections.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("scan_sessions_guid_idx").on(table.guid),
    // At most one open session per org, enforced by the engine rather than by
    // a check-then-insert in the route, which two concurrent scans both pass.
    uniqueIndex("scan_sessions_one_open_idx")
      .on(table.orgId)
      .where(sql`${table.closedAt} is null`),
  ],
);

export const collectionCards = pgTable(
  "collection_cards",
  {
    id: serial().primaryKey(),
    guid: uuid("guid").defaultRandom(),
    // NULL means the card is staged on an open scan session and is not in any
    // collection yet. INVARIANT: every query that means "cards in a
    // collection" must constrain collection_id — an unconstrained query
    // silently mixes staged cards into collection views.
    collectionId: integer("collection_id").references(() => collections.id, {
      onDelete: "cascade",
    }),
    cardId: text("card_id").notNull(),
    card: jsonb("card").notNull(),
    scannedAt: timestamp("scanned_at").notNull(),
    binNumber: integer("bin_number"),
    // The card row is written before the sorter is asked to route it, so that a
    // routing failure cannot lose the scan. That means bin_number records where
    // the card was MEANT to go, not where it is. When a brownout kills the bin
    // command mid-route, recovery drops the card into the catch-all instead —
    // this flag is what stops the row from quietly claiming it reached its bin.
    // Default false: legacy rows had no failure recorded, which is not the same
    // as a confirmed delivery.
    routeFailed: boolean("route_failed").notNull().default(false),
    // Deprecated: base64 JPEGs bloated this table badly. Captures are files on
    // disk now (see lib/captures.ts); kept nullable for one release so any
    // existing rows still render.
    capturedImageDataUrl: text("captured_image_data_url"),
    capturedImagePath: text("captured_image_path"),
    isFoil: boolean("is_foil").notNull().default(false),
    isDownloaded: boolean("is_downloaded").notNull().default(false),
    alternativeMatches: jsonb("alternative_matches"),
    // Why the scan landed where it did. needs_review means the pipeline sent
    // the card to the catch-all for a human rather than trusting its ranking;
    // score and margin are the numbers behind that call. Durable so the
    // review queue and the card detail panel survive a reload.
    needsReview: boolean("needs_review"),
    scanScore: real("scan_score"),
    scanMargin: real("scan_margin"),
    // Which printing this is (normal / reverse / holo / firstEdition). Drives
    // pricing and is expressible as a bin rule.
    variant: text("variant"),
    // What the pipeline originally decided, preserved when a human corrects it.
    //
    // `correctCard()` used to overwrite the row and reset distance to 0,
    // destroying the evidence that the model was wrong. Every correction is a
    // labelled example — the cheapest eval data available, and it was being
    // deleted on every use.
    originalCardId: text("original_card_id"),
    originalDistance: doublePrecision("original_distance"),
    originalScore: doublePrecision("original_score"),
    wasCorrected: boolean("was_corrected").notNull().default(false),
    // Stamped when a human records a verdict for this card — on the review
    // screen or via a scanner-screen correction. What the scan screen's
    // "reviewed" badge reads; NULL means no human has judged this scan.
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewVerdict: text("review_verdict"),
    // Points at scan_events.guid — the full identify diagnostics (per-signal
    // scores, OCR reading, candidate list) behind this row. Set at insert so
    // there is no window where the link is missing.
    scanEventGuid: text("scan_event_guid"),
    // Which run staged this card. Set at insert and kept after the card is
    // saved, so a collection card still records the run it came from. Commit
    // and discard both key on it.
    sessionGuid: text("session_guid"),
    orgId: text("org_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("collection_cards_guid_idx").on(table.guid),
    // The review screen resolves scan_event → collection card on every
    // detail view and verdict; without this it seq-scans the collection
    // on PGlite's main thread.
    index("collection_cards_scan_event_idx").on(table.scanEventGuid),
    // Staged-card lookup on every scan-screen load, and the commit/discard
    // predicate.
    index("collection_cards_session_idx").on(table.sessionGuid),
  ],
);

export const notificationSettings = pgTable(
  "notification_settings",
  {
    id: serial().primaryKey(),
    guid: uuid("guid").defaultRandom(),
    orgId: text("org_id").notNull(),
    discordWebhookUrl: text("discord_webhook_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("notification_settings_org_idx").on(table.orgId),
  ],
);

export const orgSettings = pgTable(
  "org_settings",
  {
    id: serial().primaryKey(),
    guid: uuid("guid").defaultRandom(),
    orgId: text("org_id").notNull(),
    primaryColor: text("primary_color"),
    scannerLayout: text("scanner_layout"),
    discordWebhookUrl: text("discord_webhook_url"),
    discordNotifyOnScan: boolean("discord_notify_on_scan")
      .notNull()
      .default(false),
    scanCoverage: integer("scan_coverage"),
    scanOffsetX: integer("scan_offset_x"),
    scanOffsetY: integer("scan_offset_y"),
    // Tenths of a degree, signed, clockwise. Integer for the same reason the
    // three above are: the region is stored as whole units of its own scale,
    // not as floats. Tenths rather than hundredths because this corrects a
    // mounting angle, and 0.1° is already finer than a camera bracket holds.
    scanRotation: integer("scan_rotation"),
    // The scan region's four corners as fractions of the frame, superseding
    // the four columns above. jsonb rather than eight more integer columns:
    // the corners are only ever read and written as one shape, and splitting
    // them would make a half-applied update representable.
    //
    // The legacy columns stay and keep their meaning. NULL here means an
    // install that has never opened the corner editor, and the client derives
    // the corners from coverage/offset/rotation so nothing changes for it.
    scanCorners: jsonb("scan_corners"),
    // ms between the IR sensor confirming a card and the frame capture.
    // Nullable: absent means the client's default (500ms) applies.
    captureSettleDelayMs: integer("capture_settle_delay_ms"),
    // Retention thresholds in whole days, all nullable for the same reason as
    // the delay above: NULL means the shipped default in DEFAULT_RETENTION, so
    // an untouched install follows the policy the build was released with. A
    // stored 0 is a choice, and means keep forever.
    retentionMachineEventDays: integer("retention_machine_event_days"),
    retentionScanEventDays: integer("retention_scan_event_days"),
    retentionAcceptCaptureDays: integer("retention_accept_capture_days"),
    retentionConfigAuditDays: integer("retention_config_audit_days"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("org_settings_org_idx").on(table.orgId),
  ],
);

// ─── Observability tables ─────────────────────────────────────────────────────
//
// Local telemetry, not product data. machine_events carries no org_id on
// purpose: it describes the one physical machine attached to this install,
// and scoping it would only complicate the queries it exists to answer.

export const machineEvents = pgTable(
  "machine_events",
  {
    id: serial().primaryKey(),
    // One session per app launch, one connection per successful port open —
    // "did it reconnect?" and "which boot was this?" are the first questions
    // asked when diagnosing a disconnect.
    sessionId: text("session_id").notNull(),
    connectionId: text("connection_id"),
    // Client-side monotonic counter; orders events that share a millisecond.
    seq: integer("seq").notNull(),
    // Client event time. The renderer and server run on the same machine, so
    // this clock is trustworthy; created_at records server receipt instead.
    //
    // timestamptz, unlike the rest of the schema: these columns exist to be
    // compared against now() in ad-hoc interval queries ("the 30 seconds
    // before the last disconnect"), and a naive timestamp written from a JS
    // Date holds UTC wall-clock while now() returns local — a silent
    // several-hour skew that would make every such query quietly wrong.
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    eventType: text("event_type").notNull(),
    // For exchange events: the command key sent ("bin", "servo", "test"...),
    // how it ended, and how long the round trip took.
    command: text("command"),
    outcome: text("outcome"),
    latencyMs: integer("latency_ms"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("machine_events_ts_idx").on(table.ts),
    index("machine_events_type_ts_idx").on(table.eventType, table.ts),
    index("machine_events_session_idx").on(table.sessionId),
  ],
);

export const scanEvents = pgTable(
  "scan_events",
  {
    id: serial().primaryKey(),
    guid: uuid("guid").defaultRandom(),
    orgId: text("org_id").notNull(),
    // Which collection was active at identify time; null when none was.
    collectionGuid: text("collection_guid"),
    gameKey: text("game_key").notNull(),
    lang: text("lang").notNull(),
    // accept | review | no-match — the pipeline's verdict. no-match scans
    // previously left no trace at all; they are often the most interesting.
    tier: text("tier").notNull(),
    score: real("score"),
    margin: real("margin"),
    // The OCR reading and the top candidates ({id, name, distance, score,
    // signals} — not hydrated cards) that decideTier saw. This is the data
    // threshold tuning needs and the client used to drop on the floor.
    ocr: jsonb("ocr"),
    candidates: jsonb("candidates"),
    stamp: jsonb("stamp"),
    // "se-<guid>.jpeg" under CAPTURES_DIR, saved for every tier.
    capturePath: text("capture_path"),
    durationMs: integer("duration_ms"),
    flippedRetry: boolean("flipped_retry").notNull().default(false),
    // Set when a human corrects the saved card: predicted-vs-actual, the
    // cheapest labelled eval data available.
    correctedCardId: text("corrected_card_id"),
    // timestamptz for the same interval-query reason as machine_events.ts.
    correctedAt: timestamp("corrected_at", { withTimezone: true }),
    // Human review state. reviewed_at IS NULL means unreviewed; the verdict is
    // correct | corrected | unresolvable. corrected_card_id above stays the
    // truth pointer for 'corrected' — 'correct' records that candidates[0]
    // was right, which is eval data a correction alone can't express.
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewVerdict: text("review_verdict"),
    // jsonb array of MismatchReason strings — multi-select, because input
    // problems (upside down, glare) and match problems (wrong set, wrong
    // type) legitimately co-occur on one card.
    mismatchReasons: jsonb("mismatch_reasons"),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("scan_events_guid_idx").on(table.guid),
    index("scan_events_created_idx").on(table.createdAt),
    index("scan_events_tier_idx").on(table.tier),
    index("scan_events_reviewed_idx").on(table.reviewedAt),
  ],
);

// ─── Audit tables (org-scoped, no FK — audit records are permanent) ───────────

export const binSetAudit = pgTable(
  "bin_set_audit",
  {
    id: serial().primaryKey(),
    guid: uuid("guid").defaultRandom(),
    binSetGuid: text("bin_set_guid").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    orgId: text("org_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("bin_set_audit_guid_idx").on(table.guid),
  ],
);

export const moduleConfigAudit = pgTable(
  "module_config_audit",
  {
    id: serial().primaryKey(),
    guid: uuid("guid").defaultRandom(),
    moduleNumber: integer("module_number").notNull(),
    orgId: text("org_id").notNull(),
    bottomClosed: integer("bottom_closed").notNull(),
    bottomOpen: integer("bottom_open").notNull(),
    paddleClosed: integer("paddle_closed").notNull(),
    paddleOpen: integer("paddle_open").notNull(),
    pusherLeft: integer("pusher_left").notNull(),
    pusherNeutral: integer("pusher_neutral").notNull(),
    pusherRight: integer("pusher_right").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("module_config_audit_guid_idx").on(table.guid),
  ],
);

export const feederConfigAudit = pgTable(
  "feeder_config_audit",
  {
    id: serial().primaryKey(),
    guid: uuid("guid").defaultRandom(),
    orgId: text("org_id").notNull(),
    speed: integer("speed").notNull(),
    duration: integer("duration").notNull(),
    pulseDuration: integer("pulse_duration").notNull(),
    pauseDuration: integer("pause_duration").notNull(),
    settleDuration: integer("settle_duration").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("feeder_config_audit_guid_idx").on(table.guid),
  ],
);

export const binSetRelations = relations(binSets, ({ many }) => ({
  bins: many(bins),
}));

export const binRelations = relations(bins, ({ one }) => ({
  binSet: one(binSets, {
    fields: [bins.binSet],
    references: [binSets.id],
  }),
}));

export const collectionRelations = relations(collections, ({ many }) => ({
  cards: many(collectionCards),
}));

export const collectionCardsRelations = relations(
  collectionCards,
  ({ one }) => ({
    collection: one(collections, {
      fields: [collectionCards.collectionId],
      references: [collections.id],
    }),
  }),
);
