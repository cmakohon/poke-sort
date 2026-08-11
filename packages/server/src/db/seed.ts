import {
  LOCAL_ORG_ID,
  POKEMON_FIELD_DEFINITIONS,
  type FieldMeta,
} from "@poke-sort/shared";
import { eq } from "drizzle-orm";
import { db } from ".";
import { POKEMON_DEFAULT_URL } from "../lib/pokemon/search";
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
    key: "pokemon",
    name: "Pokémon",
    dataSourceUrl: POKEMON_DEFAULT_URL,
    fieldDefinitions: POKEMON_FIELD_DEFINITIONS,
  },
];

/** Three servo diverter modules route cards into the seven bins. */
const MODULE_NUMBERS = [1, 2, 3];

/**
 * Adds shipped field definitions an existing install is missing.
 *
 * The games insert is ON CONFLICT DO NOTHING so that admin edits are not
 * clobbered on every boot — which also means a game seeded before a field
 * existed never gains it. That is not theoretical: a database seeded during the
 * catalog build carried 15 field definitions while the shipped set had 21, so
 * `series`, `release_year`, `dex_id`, `trainer_type`, `weakness` and
 * `legal_expanded` were simply absent from the rule builder. Nothing failed —
 * the fields were not there to fail.
 *
 * Strictly additive, matched on `field`: an entry the install already has is
 * left exactly as it is, edits included, and nothing is ever removed. The one
 * cost is that a deliberately deleted field comes back on the next boot, which
 * is the right trade against a rule builder quietly missing a third of its
 * vocabulary.
 */
async function reconcileFieldDefinitions(): Promise<void> {
  for (const seed of GAME_SEEDS) {
    const existing = await db.query.games.findFirst({
      where: (t, { eq }) => eq(t.key, seed.key),
      columns: { id: true, fieldDefinitions: true },
    });
    if (!existing) continue;

    const current = (existing.fieldDefinitions ?? []) as FieldMeta[];
    const have = new Set(current.map((f) => f.field));
    const missing = seed.fieldDefinitions.filter((f) => !have.has(f.field));
    if (missing.length === 0) continue;

    await db
      .update(games)
      .set({ fieldDefinitions: [...current, ...missing], updatedAt: new Date() })
      .where(eq(games.id, existing.id));
    console.log(
      `[seed] ${seed.key}: added ${missing.length} field definition(s): ${missing
        .map((f) => f.field)
        .join(", ")}`,
    );
  }
}

export async function seedDatabase(): Promise<void> {
  await db.insert(games).values(GAME_SEEDS).onConflictDoNothing();
  await reconcileFieldDefinitions();

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
