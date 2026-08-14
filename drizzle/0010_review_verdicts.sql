-- Review verdicts: the human side of scan_events. corrected_card_id alone
-- cannot distinguish "confirmed correct" from "never looked at" — and a
-- confirmed-correct row is eval data as valuable as a correction. reviewed_at
-- NULL means unreviewed; the verdict is correct | corrected | unresolvable;
-- mismatch_reason/review_note explain a wrong prediction for offline analysis.
ALTER TABLE "scan_events" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scan_events" ADD COLUMN IF NOT EXISTS "review_verdict" text;--> statement-breakpoint
ALTER TABLE "scan_events" ADD COLUMN IF NOT EXISTS "mismatch_reason" text;--> statement-breakpoint
ALTER TABLE "scan_events" ADD COLUMN IF NOT EXISTS "review_note" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scan_events_reviewed_idx" ON "scan_events" USING btree ("reviewed_at");
