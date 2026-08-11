import {
  FIELD_DEFINITIONS,
  LOCAL_ORG_ID,
  POKEMON_FIELD_DEFINITIONS,
} from "@magic-vault/shared";
import { db } from ".";
import { POKEMON_DEFAULT_URL } from "../lib/pokemon/search";
import { SCRYFALL_DEFAULT_URL } from "../lib/scryfall/search";
import { feederConfigs, games, moduleConfigs, orgSettings } from "./schema";

/**
 * Idempotent boot seed.
 *
 * Without this a fresh install is a blank, unusable app: `games.field_definitions`
 * drives the bin rule engine, so zero games means no collection can be created
 * and nothing can be sorted.
 *
 * Every insert is ON CONFLICT DO NOTHING rather than an upsert. Games are
 * admin-editable through `PUT /games/:guid`, so re-asserting the shipped field
 * definitions on every boot would silently clobber the user's edits. The
 * tradeoff is that corrections to the definitions below do NOT reach an
 * existing install — those need an explicit migration.
 */

const GAME_SEEDS = [
  {
    key: "mtg",
    name: "Magic: The Gathering",
    dataSourceUrl: SCRYFALL_DEFAULT_URL,
    fieldDefinitions: FIELD_DEFINITIONS,
  },
  {
    key: "pokemon",
    name: "Pokémon",
    dataSourceUrl: POKEMON_DEFAULT_URL,
    fieldDefinitions: POKEMON_FIELD_DEFINITIONS,
  },
];

/** Three servo diverter modules route cards into the seven bins. */
const MODULE_NUMBERS = [1, 2, 3];

export async function seedDatabase(): Promise<void> {
  await db.insert(games).values(GAME_SEEDS).onConflictDoNothing();

  // Servo positions and feeder timings fall back to the column defaults in
  // schema.ts; calibration overwrites them from the UI.
  await db
    .insert(moduleConfigs)
    .values(
      MODULE_NUMBERS.map((moduleNumber) => ({
        moduleNumber,
        orgId: LOCAL_ORG_ID,
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(feederConfigs)
    .values({ orgId: LOCAL_ORG_ID })
    .onConflictDoNothing();

  await db
    .insert(orgSettings)
    .values({ orgId: LOCAL_ORG_ID })
    .onConflictDoNothing();
}
