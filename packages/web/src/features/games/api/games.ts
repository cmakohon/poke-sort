import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api/client";
import type { FieldMeta, Game, Result } from "@poke-sort/shared";
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

export async function listGameLanguages(guid: string): Promise<Result<string[]>> {
  return apiGet<Result<string[]>>(`/api/games/${guid}/languages`);
}

export const gameLanguagesQueryOptions = (guid: string | undefined) =>
  queryOptions({
    queryKey: ["games", guid, "languages"] as const,
    queryFn: () => listGameLanguages(guid!).then((r) => r.data ?? []),
    enabled: !!guid,
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
