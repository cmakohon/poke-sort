-- A card row is written before the sorter is asked to route it, so that a
-- failed route cannot lose the scan. bin_number therefore records where the
-- card was MEANT to go. When a brownout resets the board mid-route the bin
-- command dies with it, recovery drops the card into the catch-all, and the row
-- was left claiming a delivery that never happened — three cards in one session
-- on 2026-08-21. This flag is how a row says so.
--
-- Default false rather than backfilling true: no failure was recorded for
-- existing rows, which is not the same as a confirmed delivery.
ALTER TABLE "collection_cards" ADD COLUMN IF NOT EXISTS "route_failed" boolean DEFAULT false NOT NULL;
