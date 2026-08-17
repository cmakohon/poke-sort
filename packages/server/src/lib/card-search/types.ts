import type { PlayingCard, Result } from "@poke-sort/shared";

/**
 * A game's remote card API, for the one thing the local catalog cannot answer:
 * the current upstream state of a known card. Live price refresh needs that by
 * definition, and review hydrates candidates through the same path.
 *
 * Name search does NOT go through here — it reads the local catalog directly
 * (lib/card-search/local.ts), which has every printing and no page cap.
 */
export interface CardSearchAdapter {
  defaultUrl: string;
  searchById(id: string, baseUrl: string): Promise<Result<PlayingCard>>;
}
