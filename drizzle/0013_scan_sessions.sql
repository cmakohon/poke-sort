-- Scanning is a session, not an edit to a collection.
--
-- Every scan used to insert straight into the active collection, so the scan
-- screen showed that collection's entire history and there was no way to throw
-- away a test run — the only escape was emptying the collection afterwards.
-- Cards now stage against a session (collection_id NULL, session_guid set) and
-- only acquire a collection_id when the user saves. Discard deletes the rows.
--
-- scan_events is a separate table that neither path touches, so the identify
-- diagnostics and the human review verdicts survive a discard. That is the
-- reason staging lives here rather than in client state: the review screen's
-- training data must not depend on whether the operator kept the run.
--
-- Staged rows are invisible to every existing collection query for free —
-- they all constrain collection_id, including the card count in
-- _loadCollections. Any *new* query that means "cards in a collection" must
-- keep doing so; an unconstrained one silently mixes staged cards in.
--
-- No backfill: every existing row has collection_id set and is therefore
-- already committed.
CREATE TABLE IF NOT EXISTS "scan_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"guid" uuid DEFAULT gen_random_uuid(),
	"org_id" text NOT NULL,
	"target_collection_id" integer,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"outcome" text,
	"saved_collection_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scan_sessions_guid_idx" UNIQUE("guid")
);
--> statement-breakpoint
ALTER TABLE "collection_cards" ALTER COLUMN "collection_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_cards" ADD COLUMN IF NOT EXISTS "session_guid" text;--> statement-breakpoint
-- SET NULL, not CASCADE: deleting the target collection must not destroy an
-- in-flight run. The staged cards are already immune (their collection_id is
-- NULL, so the collection_cards cascade misses them) and the session stays
-- open, just targetless, until the operator picks a new destination.
ALTER TABLE "scan_sessions" ADD CONSTRAINT "scan_sessions_target_collection_id_collections_id_fk" FOREIGN KEY ("target_collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_sessions" ADD CONSTRAINT "scan_sessions_saved_collection_id_collections_id_fk" FOREIGN KEY ("saved_collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- One open session per org, enforced by the engine rather than by a
-- check-then-insert in the route, which two concurrent scans would both pass.
CREATE UNIQUE INDEX IF NOT EXISTS "scan_sessions_one_open_idx" ON "scan_sessions" USING btree ("org_id") WHERE "scan_sessions"."closed_at" is null;--> statement-breakpoint
-- Staged-card lookup on every scan-screen load, plus the commit/discard
-- predicate.
CREATE INDEX IF NOT EXISTS "collection_cards_session_idx" ON "collection_cards" USING btree ("session_guid");
