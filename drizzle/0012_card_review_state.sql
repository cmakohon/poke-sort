-- Review state lands on the collection card itself. The review screen's
-- verdicts were only visible on scan_events, so the scan screen had no way
-- to show "a human already judged this card" — a reviewed-and-corrected card
-- still looked exactly like an unreviewed one. Backfilled from scan_events
-- via the scan_event_guid join so verdicts recorded before this migration
-- get their badge too.
ALTER TABLE "collection_cards" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "collection_cards" ADD COLUMN IF NOT EXISTS "review_verdict" text;--> statement-breakpoint
UPDATE "collection_cards" cc SET "reviewed_at" = se."reviewed_at", "review_verdict" = se."review_verdict" FROM "scan_events" se WHERE se."guid"::text = cc."scan_event_guid" AND se."reviewed_at" IS NOT NULL AND cc."reviewed_at" IS NULL;
