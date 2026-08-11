ALTER TABLE "cards" RENAME COLUMN "scryfall_id" TO "card_id";--> statement-breakpoint
ALTER TABLE "collection_cards" RENAME COLUMN "scryfall_id" TO "card_id";--> statement-breakpoint
ALTER TABLE "cards" RENAME CONSTRAINT "card_image_vectors_scryfall_face_idx" TO "cards_card_id_idx";--> statement-breakpoint
ALTER TABLE "cards" ALTER COLUMN "game_key" SET DEFAULT 'pokemon';
