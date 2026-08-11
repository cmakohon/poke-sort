-- Why a scan landed where it did, made durable.
--
-- The fused score and the review flag existed only in the client's session
-- memory: never posted, never stored. Two consequences — the "needs
-- attention" filter emptied itself on every reload, and a card sitting in the
-- catch-all bin carried no explanation a day later. A sorter's decisions
-- should outlive the tab that made them.
ALTER TABLE "collection_cards" ADD COLUMN IF NOT EXISTS "needs_review" boolean;--> statement-breakpoint
ALTER TABLE "collection_cards" ADD COLUMN IF NOT EXISTS "scan_score" real;--> statement-breakpoint
ALTER TABLE "collection_cards" ADD COLUMN IF NOT EXISTS "scan_margin" real;
