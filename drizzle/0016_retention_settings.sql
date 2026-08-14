-- How long the app keeps the data it generates about itself, as a setting
-- rather than a constant.
--
-- Retention was three numbers compiled into the server: telemetry 14 days,
-- scan diagnostics 180, accepted-scan captures 30. That is a reasonable policy
-- and an invisible one — data vanished on a schedule the user could not see,
-- could not change, and could not shorten when the captures directory got big.
-- The new Data usage screen shows both, so the thresholds have to be readable
-- and writable from the API.
--
-- Nullable, following capture_settle_delay_ms: NULL means "use the shipped
-- default", so an install that never opens the setting behaves exactly as it
-- did before, and a later change to the default reaches it. A stored 0 is a
-- deliberate choice and means "keep forever" — which is why the columns cannot
-- simply default to the current constants.
--
-- config_audit_days is new policy, not a move: the bin/module/feeder audit
-- tables have never been pruned. It ships as NULL -> 0 -> forever, so nothing
-- starts deleting on its own; the user opts in.
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "retention_machine_event_days" integer;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "retention_scan_event_days" integer;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "retention_accept_capture_days" integer;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "retention_config_audit_days" integer;
