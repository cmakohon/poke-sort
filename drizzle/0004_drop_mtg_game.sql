-- Retire the Magic game row left behind by earlier seeds.
--
-- The boot seed is ON CONFLICT DO NOTHING, so dropping "mtg" from GAME_SEEDS
-- stops new installs from getting it but leaves existing ones with a game whose
-- search adapter and sync source no longer exist.
--
-- Catalog cards go unconditionally: they are upstream data, not user data, and
-- nothing can be scanned against them any more. The game row itself is only
-- removed when nothing references it, so a user who actually sorted Magic keeps
-- their collections and bin sets rather than having them deleted out from under
-- them.
DELETE FROM "cards" WHERE "game_key" = 'mtg';--> statement-breakpoint
DELETE FROM "games" g
  WHERE g."key" = 'mtg'
    AND NOT EXISTS (SELECT 1 FROM "collections" c WHERE c."game_id" = g."id")
    AND NOT EXISTS (SELECT 1 FROM "bin_sets" b WHERE b."game_id" = g."id");
