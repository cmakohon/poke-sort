-- A trigram index on card names, for the correction search.
--
-- The correction picker used to proxy to TCGdex with itemsPerPage=30 and no
-- paging, so the right printing of a common Pokemon was frequently unreachable.
-- It now searches this table instead, which has every printing the sorter could
-- ever have scanned — but that means an ILIKE '%...%' over ~22k rows on every
-- debounced keystroke.
--
-- The index is required, not an optimisation. PGlite executes on the main
-- thread and cannot cancel a running query, so an unindexed sequential scan
-- would stall the whole process — including an active sort — once per
-- keystroke. pg_trgm is already enabled (0000) and already loaded into the
-- PGlite instance; nothing had used it until now.
CREATE INDEX IF NOT EXISTS "cards_name_trgm_idx"
  ON "cards" USING gin ("name" gin_trgm_ops);
