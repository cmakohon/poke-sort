import type { Result, ScryfallCard } from "@magic-vault/shared";

export interface CardSearchAdapter {
  search(query: string, baseUrl: string): Promise<Result<ScryfallCard[]>>;
  searchById(id: string, baseUrl: string): Promise<Result<ScryfallCard>>;
}
