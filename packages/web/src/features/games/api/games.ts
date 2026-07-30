import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api/client";
import type { FieldMeta, Game, Result } from "@magic-vault/shared";
import { queryOptions } from "@tanstack/react-query";

export interface GameInput {
  key: string;
  name: string;
  dataSourceUrl: string;
  fieldDefinitions: FieldMeta[];
  isActive: boolean;
}

export async function listGames(): Promise<Result<Game[]>> {
  return apiGet<Result<Game[]>>("/api/games");
}

export const gamesQueryOptions = queryOptions({
  queryKey: ["games"] as const,
  queryFn: () => listGames().then((r) => r.data ?? []),
  staleTime: Infinity,
});

export async function createGame(input: GameInput): Promise<Result<Game>> {
  return apiPost<Result<Game>>("/api/games", input);
}

export async function updateGame(
  guid: string,
  input: Partial<GameInput>,
): Promise<Result<Game>> {
  return apiPut<Result<Game>>(`/api/games/${guid}`, input);
}

export async function deleteGame(guid: string): Promise<Result<null>> {
  return apiDelete<Result<null>>(`/api/games/${guid}`);
}
