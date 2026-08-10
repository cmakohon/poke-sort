ALTER TABLE "cards" ADD COLUMN "collector_number" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "set_total" integer;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "card_data" jsonb;--> statement-breakpoint
ALTER TABLE "collection_cards" ADD COLUMN "variant" text;--> statement-breakpoint
ALTER TABLE "collection_cards" ADD COLUMN "original_card_id" text;--> statement-breakpoint
ALTER TABLE "collection_cards" ADD COLUMN "original_distance" double precision;--> statement-breakpoint
ALTER TABLE "collection_cards" ADD COLUMN "original_score" double precision;--> statement-breakpoint
ALTER TABLE "collection_cards" ADD COLUMN "was_corrected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "cards_game_lang_idx" ON "cards" USING btree ("game_key","lang");--> statement-breakpoint
CREATE INDEX "cards_collector_number_idx" ON "cards" USING btree ("collector_number");