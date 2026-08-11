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
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm/relations";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(768)"; // 768 dimensions — SigLIP ViT-Base-Patch16-224 embeddings
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

export const collectionCards = pgTable(
  "collection_cards",
  {
    id: serial().primaryKey(),
    guid: uuid("guid").defaultRandom(),
    collectionId: integer("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    cardId: text("card_id").notNull(),
    card: jsonb("card").notNull(),
    scannedAt: timestamp("scanned_at").notNull(),
    binNumber: integer("bin_number"),
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
    orgId: text("org_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("collection_cards_guid_idx").on(table.guid),
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
    // ms between the IR sensor confirming a card and the frame capture.
    // Nullable: absent means the client's default (500ms) applies.
    captureSettleDelayMs: integer("capture_settle_delay_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("org_settings_org_idx").on(table.orgId),
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
