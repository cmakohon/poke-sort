-- Mismatch reasons become multi-select. The single-reason column forced a
-- false choice: input problems (upside down, glare) and match problems
-- (wrong set, wrong type) legitimately co-occur on one card, and picking one
-- hides the other from the eval data. Existing single reasons are carried
-- over as one-element arrays before the old column goes away.
ALTER TABLE "scan_events" ADD COLUMN IF NOT EXISTS "mismatch_reasons" jsonb;--> statement-breakpoint
UPDATE "scan_events" SET "mismatch_reasons" = to_jsonb(array["mismatch_reason"]) WHERE "mismatch_reason" IS NOT NULL AND "mismatch_reasons" IS NULL;--> statement-breakpoint
ALTER TABLE "scan_events" DROP COLUMN IF EXISTS "mismatch_reason";
