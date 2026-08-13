-- Observability: machine_events + scan_events + the link column.
--
-- Two kinds of flying blind, one migration. Serial failures (disconnects,
-- timeouts, mid-session MCU reboots) only ever existed as DevTools console
-- lines that vanished on restart — machine_events makes every exchange and
-- lifecycle event durable and queryable. And the identify pipeline computed
-- per-signal scores, an OCR reading, and a ranked candidate list for every
-- scan, then threw them away — scan_events keeps them for all tiers,
-- including no-match scans, which previously left no row and no image.
--
-- Two deliberate deviations from house style: machine_events carries no
-- org_id (it describes the one physical machine attached to this install),
-- and the time columns are timestamptz, because these tables exist to be
-- queried with SQL interval arithmetic against now() — a naive timestamp
-- written from a JS Date holds UTC wall-clock while now() returns local,
-- a silent several-hour skew.
CREATE TABLE IF NOT EXISTS "machine_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"connection_id" text,
	"seq" integer NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"event_type" text NOT NULL,
	"command" text,
	"outcome" text,
	"latency_ms" integer,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scan_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"guid" uuid DEFAULT gen_random_uuid(),
	"org_id" text NOT NULL,
	"collection_guid" text,
	"game_key" text NOT NULL,
	"lang" text NOT NULL,
	"tier" text NOT NULL,
	"score" real,
	"margin" real,
	"ocr" jsonb,
	"candidates" jsonb,
	"stamp" jsonb,
	"capture_path" text,
	"duration_ms" integer,
	"flipped_retry" boolean DEFAULT false NOT NULL,
	"corrected_card_id" text,
	"corrected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_events_guid_idx" UNIQUE("guid")
);
--> statement-breakpoint
ALTER TABLE "collection_cards" ADD COLUMN IF NOT EXISTS "scan_event_guid" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machine_events_ts_idx" ON "machine_events" USING btree ("ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machine_events_type_ts_idx" ON "machine_events" USING btree ("event_type","ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machine_events_session_idx" ON "machine_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scan_events_created_idx" ON "scan_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scan_events_tier_idx" ON "scan_events" USING btree ("tier");
