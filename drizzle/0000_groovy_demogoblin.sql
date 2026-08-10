-- Extensions must exist before the tables that use their types.
-- Nothing in the repo used to create these; Neon enabled them out of band.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "bin_set_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"guid" uuid DEFAULT gen_random_uuid(),
	"bin_set_guid" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"org_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bin_set_audit_guid_idx" UNIQUE("guid")
);
--> statement-breakpoint
CREATE TABLE "bin_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"guid" uuid DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"game_id" integer,
	"org_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bin_sets_guid_idx" UNIQUE("guid")
);
--> statement-breakpoint
CREATE TABLE "bins" (
	"id" serial PRIMARY KEY NOT NULL,
	"guid" uuid DEFAULT gen_random_uuid(),
	"rules" jsonb NOT NULL,
	"is_catch_all" boolean DEFAULT false NOT NULL,
	"bin_number" integer NOT NULL,
	"bin_set" integer NOT NULL,
	"org_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bins_guid_idx" UNIQUE("guid")
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"guid" uuid DEFAULT gen_random_uuid(),
	"scryfall_id" text NOT NULL,
	"game_key" text DEFAULT 'mtg' NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"name" text NOT NULL,
	"set_code" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "card_image_vectors_scryfall_face_idx" UNIQUE("scryfall_id")
);
--> statement-breakpoint
CREATE TABLE "collection_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"guid" uuid DEFAULT gen_random_uuid(),
	"collection_id" integer NOT NULL,
	"scryfall_id" text NOT NULL,
	"card" jsonb NOT NULL,
	"scanned_at" timestamp NOT NULL,
	"bin_number" integer,
	"captured_image_data_url" text,
	"captured_image_path" text,
	"is_foil" boolean DEFAULT false NOT NULL,
	"is_downloaded" boolean DEFAULT false NOT NULL,
	"alternative_matches" jsonb,
	"org_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "collection_cards_guid_idx" UNIQUE("guid")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"guid" uuid DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"game_id" integer,
	"lang" text DEFAULT 'en' NOT NULL,
	"org_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "collections_guid_idx" UNIQUE("guid")
);
--> statement-breakpoint
CREATE TABLE "feeder_config_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"guid" uuid DEFAULT gen_random_uuid(),
	"org_id" text NOT NULL,
	"speed" integer NOT NULL,
	"duration" integer NOT NULL,
	"pulse_duration" integer NOT NULL,
	"pause_duration" integer NOT NULL,
	"settle_duration" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feeder_config_audit_guid_idx" UNIQUE("guid")
);
--> statement-breakpoint
CREATE TABLE "feeder_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"guid" uuid DEFAULT gen_random_uuid(),
	"org_id" text NOT NULL,
	"speed" integer DEFAULT 400 NOT NULL,
	"duration" integer DEFAULT 3000 NOT NULL,
	"pulse_duration" integer DEFAULT 80 NOT NULL,
	"pause_duration" integer DEFAULT 50 NOT NULL,
	"settle_duration" integer DEFAULT 150 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feeder_configs_org_idx" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" serial PRIMARY KEY NOT NULL,
	"guid" uuid DEFAULT gen_random_uuid(),
	"key" text NOT NULL,
	"name" text NOT NULL,
	"data_source_url" text NOT NULL,
	"field_definitions" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "games_key_idx" UNIQUE("key"),
	CONSTRAINT "games_guid_idx" UNIQUE("guid")
);
--> statement-breakpoint
CREATE TABLE "module_config_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"guid" uuid DEFAULT gen_random_uuid(),
	"module_number" integer NOT NULL,
	"org_id" text NOT NULL,
	"bottom_closed" integer NOT NULL,
	"bottom_open" integer NOT NULL,
	"paddle_closed" integer NOT NULL,
	"paddle_open" integer NOT NULL,
	"pusher_left" integer NOT NULL,
	"pusher_neutral" integer NOT NULL,
	"pusher_right" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "module_config_audit_guid_idx" UNIQUE("guid")
);
--> statement-breakpoint
CREATE TABLE "module_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"guid" uuid DEFAULT gen_random_uuid(),
	"module_number" integer NOT NULL,
	"org_id" text NOT NULL,
	"bottom_closed" integer DEFAULT 102 NOT NULL,
	"bottom_open" integer DEFAULT 307 NOT NULL,
	"paddle_closed" integer DEFAULT 150 NOT NULL,
	"paddle_open" integer DEFAULT 307 NOT NULL,
	"pusher_left" integer DEFAULT 150 NOT NULL,
	"pusher_neutral" integer DEFAULT 307 NOT NULL,
	"pusher_right" integer DEFAULT 460 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "module_configs_org_module_idx" UNIQUE("org_id","module_number")
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"guid" uuid DEFAULT gen_random_uuid(),
	"org_id" text NOT NULL,
	"discord_webhook_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_org_idx" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"guid" uuid DEFAULT gen_random_uuid(),
	"org_id" text NOT NULL,
	"primary_color" text,
	"scanner_layout" text,
	"discord_webhook_url" text,
	"discord_notify_on_scan" boolean DEFAULT false NOT NULL,
	"scan_coverage" integer,
	"scan_offset_x" integer,
	"scan_offset_y" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_settings_org_idx" UNIQUE("org_id")
);
--> statement-breakpoint
ALTER TABLE "bin_sets" ADD CONSTRAINT "bin_sets_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bins" ADD CONSTRAINT "bins_bin_set_bin_sets_id_fk" FOREIGN KEY ("bin_set") REFERENCES "public"."bin_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_cards" ADD CONSTRAINT "collection_cards_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;