-- How long the scanner waits after the IR sensor confirms a card before
-- capturing the frame. Was hardcoded at 500ms; real machines differ in feeder
-- speed and card friction, and a capture taken while the card is still
-- sliding matches nothing. Upstream stored this per-org; the fork lost it in
-- the settings squeeze and hardcoded the default.
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "capture_settle_delay_ms" integer;
