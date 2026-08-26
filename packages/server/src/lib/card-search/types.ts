import type { PlayingCard, Result } from "@poke-sort/shared";

/**
 * A game's remote card API, for the things the local catalog cannot answer:
 * the current upstream state of a known card (live price refresh needs that by
 * definition, and review hydrates candidates through the same path), and the
 * cards the catalog never imported at all.
 *
 * Ordinary name search does NOT go through here — it reads the local catalog
 * directly (lib/card-search/local.ts), which has every printing it could have
 * scanned and no page cap. `searchByName` is the explicit fallback the review
 * screen offers once that search comes back empty, and nothing calls it per
 * keystroke: it costs one detail fetch per hit.
 */
export interface CardSearchAdapter {
  defaultUrl: string;
  searchById(id: string, baseUrl: string): Promise<Result<PlayingCard>>;
  searchByName?(query: string, baseUrl: string): Promise<Result<PlayingCard[]>>;
}
