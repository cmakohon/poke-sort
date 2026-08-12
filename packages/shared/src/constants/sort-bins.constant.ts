import type { BinRuleGroup } from "../interfaces/sort-bins.interface";

export const BIN_COUNT = 7;

export const SET_NAME_MAX_LENGTH = 50;
export const CONDITION_STRING_MAX_LENGTH = 200;
export const CONDITION_NUMERIC_MAX = 100_000;

export type DefaultBinInit = {
  binNumber: number;
  rules: BinRuleGroup;
  isCatchAll: boolean;
  /** Omitted by the default layout: review falls back to the catch-all. */
  isReviewBin?: boolean;
};

/**
 * The starting bin layout for a new set: every bin empty, the last one the
 * catch-all.
 *
 * There is deliberately no rule-populated default: no single split is the
 * obvious first cut for Pokemon. Type, rarity and set are all reasonable, and
 * which one is right depends on what is being sorted — so the bin editor opens
 * on a blank layout rather than a guess.
 */
export function createDefaultCatchAllOnlyBins(): DefaultBinInit[] {
  return Array.from({ length: BIN_COUNT }, (_, i) => ({
    binNumber: i + 1,
    isCatchAll: i === BIN_COUNT - 1,
    rules: {
      id: crypto.randomUUID(),
      combinator: "and" as const,
      conditions: [],
    } satisfies BinRuleGroup,
  }));
}
