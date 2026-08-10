import type {
  ConditionOperator,
  FieldMeta,
} from "../interfaces/sort-bins.interface";

/**
 * Bin-rule field definitions for Pokemon (TCGdex).
 *
 * SCAFFOLD — needs review. These were reconstructed from the TCGdex API rather
 * than lifted from the production `games` table, so the field set is a judgment
 * call even where the vocabularies are exact. Lines marked REVIEW are the ones
 * most worth a second look.
 *
 * Every `path` below is resolved by `getCardValue` in `evaluate-bin.ts`, which
 * tries `card.raw` FIRST and only falls back to the normalized `PlayingCard`.
 * For Pokemon `card.raw` is the TCGdex card detail, so paths and enum values
 * must match TCGdex's shape and casing — not the normalized card's. This is
 * why `rarity` options are title-case here while the MTG ones are lowercase.
 *
 * The enum vocabularies (rarity, types, category, stage) are the complete
 * lists served by TCGdex's /rarities, /types, /categories and /stages
 * endpoints as of 2026-08-10, not a hand-picked subset.
 */

const STRING_OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "does not equal" },
];

const NUMERIC_OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: "gt", label: "greater than" },
  { value: "gte", label: "greater than or equal" },
  { value: "lt", label: "less than" },
  { value: "lte", label: "less than or equal" },
  { value: "equals", label: "equals" },
];

const ENUM_OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: "in", label: "is any of" },
  { value: "not_in", label: "is none of" },
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "does not equal" },
];

const SET_OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: "contains_any", label: "contains any of" },
  { value: "contains_all", label: "contains all of" },
  { value: "contains_none", label: "contains none of" },
  { value: "equals", label: "is exactly" },
];

const asOptions = (values: string[]) =>
  values.map((value) => ({ value, label: value }));

/** TCGdex /rarities, verbatim. Long, but pruning it silently breaks rules. */
const POKEMON_RARITIES = [
  "ACE SPEC Rare",
  "Amazing Rare",
  "Black White Rare",
  "Classic Collection",
  "Common",
  "Crown",
  "Double rare",
  "Four Diamond",
  "Full Art Trainer",
  "Holo Rare",
  "Holo Rare V",
  "Holo Rare VMAX",
  "Holo Rare VSTAR",
  "Hyper rare",
  "Illustration rare",
  "LEGEND",
  "Mega Hyper Rare",
  "None",
  "One Diamond",
  "One Shiny",
  "One Star",
  "Promo",
  "Radiant Rare",
  "Rare",
  "Rare Holo",
  "Rare Holo LV.X",
  "Rare PRIME",
  "Secret Rare",
  "Shiny Ultra Rare",
  "Shiny rare",
  "Shiny rare V",
  "Shiny rare VMAX",
  "Special illustration rare",
  "Three Diamond",
  "Three Star",
  "Two Diamond",
  "Two Shiny",
  "Two Star",
  "Ultra Rare",
  "Uncommon",
];

/** TCGdex /types — Pokemon energy types. */
const POKEMON_ENERGY_TYPES = [
  "Colorless",
  "Darkness",
  "Dragon",
  "Fairy",
  "Fighting",
  "Fire",
  "Grass",
  "Lightning",
  "Metal",
  "Psychic",
  "Water",
];

/** TCGdex /stages. */
const POKEMON_STAGES = [
  "BREAK",
  "Basic",
  "LEVEL-UP",
  "MEGA",
  "RESTORED",
  "Stage1",
  "Stage2",
  "V-UNION",
  "VMAX",
  "VSTAR",
];

export const POKEMON_FIELD_DEFINITIONS: FieldMeta[] = [
  {
    field: "name",
    label: "Name",
    type: "string",
    path: "name",
    operators: STRING_OPERATORS,
  },
  {
    // REVIEW: casing. TCGdex returns "Double rare", "Ultra Rare", "Holo Rare V"
    // — inconsistent capitalization is theirs, not a typo here. The normalized
    // card lowercases rarity but `raw` wins, so these must stay title-case.
    field: "rarity",
    label: "Rarity",
    type: "enum",
    path: "rarity",
    operators: ENUM_OPERATORS,
    options: asOptions(POKEMON_RARITIES),
  },
  {
    // The Pokemon analogue of MTG's color_identity: an array on the raw card.
    field: "types",
    label: "Energy Type",
    type: "set",
    path: "types",
    operators: SET_OPERATORS,
    options: asOptions(POKEMON_ENERGY_TYPES),
  },
  {
    field: "category",
    label: "Category",
    type: "enum",
    path: "category",
    operators: ENUM_OPERATORS,
    options: asOptions(["Energy", "Pokemon", "Trainer"]),
  },
  {
    // Absent on Trainer/Energy cards — those evaluate as "" and will not match
    // any `in` condition, which is the intended behaviour.
    field: "stage",
    label: "Stage",
    type: "enum",
    path: "stage",
    operators: ENUM_OPERATORS,
    options: asOptions(POKEMON_STAGES),
  },
  {
    field: "hp",
    label: "HP",
    type: "numeric",
    path: "hp",
    operators: NUMERIC_OPERATORS,
  },
  {
    // REVIEW: path is `set.id`, NOT `set`. On TCGdex `raw.set` is an object
    // ({id, name, cardCount, ...}); pointing at it would stringify to
    // "[object Object]" and never match. MTG can use a bare `set` because
    // Scryfall's raw `set` is already the set code.
    field: "set",
    label: "Set Code",
    type: "string",
    path: "set.id",
    operators: STRING_OPERATORS,
  },
  {
    field: "set_name",
    label: "Set Name",
    type: "string",
    path: "set.name",
    operators: STRING_OPERATORS,
  },
  {
    // The printed collector number, e.g. "58" of "58/102". Pair with
    // set.cardCount.official to reconstruct the full printed number.
    field: "collector_number",
    label: "Collector Number",
    type: "string",
    path: "localId",
    operators: STRING_OPERATORS,
  },
  {
    // No `price` key on the raw card, so this deliberately falls through to the
    // normalized card's resolvePrice() result — same as MTG.
    field: "price_usd",
    label: "Price (USD)",
    type: "numeric",
    path: "price",
    operators: NUMERIC_OPERATORS,
  },
  {
    field: "retreat",
    label: "Retreat Cost",
    type: "numeric",
    path: "retreat",
    operators: NUMERIC_OPERATORS,
  },
  {
    field: "illustrator",
    label: "Illustrator",
    type: "string",
    path: "illustrator",
    operators: STRING_OPERATORS,
  },
  {
    // REVIEW: only present on Sword & Shield era cards and newer; older cards
    // have no regulation mark at all. Kept as a free-text field rather than an
    // enum because the letter series keeps growing (currently A-I).
    field: "regulation_mark",
    label: "Regulation Mark",
    type: "string",
    path: "regulationMark",
    operators: STRING_OPERATORS,
  },
  {
    // Falls through to the normalized card, which joins effect + description +
    // ability text + attack text into one searchable blob.
    field: "text",
    label: "Card Text",
    type: "string",
    path: "text",
    operators: STRING_OPERATORS,
  },
  {
    // REVIEW: drop this if it is not worth a bin. FieldType has no boolean, so
    // it is modelled as an enum of stringified booleans — conditions compare
    // via String(value), so "true"/"false" match correctly.
    field: "legal_standard",
    label: "Standard Legal",
    type: "enum",
    path: "legal.standard",
    operators: ENUM_OPERATORS,
    options: [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
  },
];

// NOT YET INCLUDED — `variant` (normal / reverse / holo / firstEdition) is a
// Phase 4d concern: it needs a `variant` column on collection_cards and a
// scan-time choice before a bin rule can reference it.
