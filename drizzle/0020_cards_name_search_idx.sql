-- Re-point the correction search index at the folded form of the name.
--
-- The search compared raw names with ILIKE, which is literal — so "Poke Ball"
-- matched nothing at all while "Poké Ball" matched 24 printings, and the same
-- held for "Farfetchd", "Ho Oh", "Type Null", and every trainer card whose
-- apostrophe is the curly U+2019. The card was in the catalog and simply
-- unreachable, which reads from the picker as the results being truncated.
--
-- Both sides now compare on the expression below (see `folded` in
-- lib/card-search/local.ts, which must match this character for character).
-- Indexing the expression rather than the column is what keeps that comparison
-- off a sequential scan: PGlite runs on the main thread and cannot cancel a
-- query, so ~22k unindexed rows per debounced keystroke would stall the server
-- mid-sort. Same reasoning as 0018, which indexed the raw column.
CREATE INDEX IF NOT EXISTS "cards_name_search_idx"
  ON "cards" USING gin (
    btrim(regexp_replace(translate(lower("name"), 'é''’', 'e'), '[^a-z0-9]+', ' ', 'g'))
    gin_trgm_ops
  );
--> statement-breakpoint
-- Nothing reads the raw-name index now: local.ts was its only caller.
DROP INDEX IF EXISTS "cards_name_trgm_idx";
