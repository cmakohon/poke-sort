-- Remember what a run's cards were actually identified against.
--
-- A session targets a collection, and that collection supplies the game key
-- and language to the identify pipeline. But switching collections mid-run
-- re-points the target, so by the time the operator saves, the target can name
-- a different game than the one the staged cards were read against — and
-- nothing re-identifies them on the way into a collection.
--
-- These are stamped from the target when the first card is staged and frozen
-- from then on, so the save dialog can warn about a genuine mismatch instead of
-- comparing the target against itself.
--
-- Nullable and unbackfilled: an existing open session has no first-card moment
-- to recover, and a closed one is never inspected again.
ALTER TABLE "scan_sessions" ADD COLUMN IF NOT EXISTS "identified_game_key" text;--> statement-breakpoint
ALTER TABLE "scan_sessions" ADD COLUMN IF NOT EXISTS "identified_lang" text;
