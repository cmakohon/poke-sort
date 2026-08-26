/**
 * Splits a correction-search query into the parts the catalog can index.
 *
 * The search used to match card names and nothing else, so a reviewer holding
 * a card could not look it up by the one thing printed unambiguously on it —
 * its collector number. "SM125" found nothing; neither did "4/102". That reads
 * as "the card isn't in the catalog" when the row is right there.
 *
 * Number tokens are recognised structurally rather than by trying the catalog
 * first: a token is a collector number when it is at most three letters of
 * prefix, then digits, then an optional letter — which covers "4", "102",
 * "SM125", "TG12", "GG05" and "H1", and deliberately does not cover "Porygon2"
 * (seven letters of prefix) or a set code like "swsh4" (four).
 */

export interface ParsedSearchQuery {
  /** The words to match against the card name; "" when it was all numbers. */
  name: string;
  /**
   * Collector-number literals to try, expanded over case and zero-padding.
   * Compared with equality against an indexed column rather than folded, so
   * every form the catalog might store has to be listed explicitly.
   */
  numbers: string[];
  /** From an "n/m" token: the set's official card count. */
  setTotal: number | null;
}

/** "4/102" — the number and the set total, as printed. */
const FRACTION = /^(\d{1,4})\/(\d{1,4})$/;
/** "SM125", "TG12", "H1", "102" — see the note above on the prefix bound. */
const NUMBER_TOKEN = /^[A-Za-z]{0,3}\d{1,4}[A-Za-z]?$/;
/** Splits a number token so its digits can be re-padded. */
const NUMBER_PARTS = /^([A-Za-z]*)(\d+)([A-Za-z]?)$/;

/**
 * Every spelling of one collector number the catalog might hold.
 *
 * Catalogs are inconsistent about both case ("sm125" vs "SM125") and leading
 * zeros ("1" vs "001"), and there is no folded expression index on this column
 * to normalise them away — so the alternatives are enumerated and handed to an
 * IN list, which still uses cards_collector_number_idx.
 */
function numberVariants(token: string): string[] {
  const out = new Set<string>();
  const add = (value: string) => {
    out.add(value);
    out.add(value.toUpperCase());
    out.add(value.toLowerCase());
  };
  add(token);
  const parts = NUMBER_PARTS.exec(token);
  if (parts) {
    const [, prefix, digits, suffix] = parts;
    const bare = String(Number(digits));
    for (const padded of [bare, bare.padStart(2, "0"), bare.padStart(3, "0")]) {
      add(`${prefix}${padded}${suffix}`);
    }
  }
  return [...out];
}

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const nameTokens: string[] = [];
  const numbers = new Set<string>();
  let setTotal: number | null = null;

  for (const token of raw.trim().split(/\s+/).filter(Boolean)) {
    const fraction = FRACTION.exec(token);
    if (fraction) {
      for (const variant of numberVariants(fraction[1])) numbers.add(variant);
      setTotal = Number(fraction[2]);
      continue;
    }
    if (NUMBER_TOKEN.test(token)) {
      for (const variant of numberVariants(token)) numbers.add(variant);
      continue;
    }
    nameTokens.push(token);
  }

  return { name: nameTokens.join(" "), numbers: [...numbers], setTotal };
}
