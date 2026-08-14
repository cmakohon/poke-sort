-- The capture window's angle, in tenths of a degree, signed and clockwise.
--
-- The existing coverage/offset columns can move and size an axis-aligned box
-- but never turn it, so a camera bolted a degree or two off square produced
-- crooked crops that no amount of calibration could straighten.
--
-- Tenths rather than the hundredths the offsets use: this corrects a mounting
-- angle, and 0.1° is already finer than a camera bracket holds. Nullable, so
-- absent means the previous behaviour exactly — a square box.
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "scan_rotation" integer;
