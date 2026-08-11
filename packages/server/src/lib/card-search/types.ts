import type { PlayingCard, Result } from "@poke-sort/shared";

export interface CardSearchAdapter {
  defaultUrl: string;
  search(query: string, baseUrl: string): Promise<Result<PlayingCard[]>>;
  searchById(id: string, baseUrl: string): Promise<Result<PlayingCard>>;
}
