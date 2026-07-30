import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/delete-dialog";
import {
  createGame,
  deleteGame,
  gamesQueryOptions,
  updateGame,
} from "@/features/games/api/games";
import type { Game } from "@magic-vault/shared";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { GameFormDialog, toFieldDefinitions, type GameFormValues } from "./game-form-dialog";

export function GamesManager() {
  const queryClient = useQueryClient();
  const [formGame, setFormGame] = useState<Game | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Game | null>(null);

  const gamesQuery = useQuery(gamesQueryOptions);

  function setGames(games: Game[]) {
    queryClient.setQueryData(gamesQueryOptions.queryKey, games);
  }

  const createMutation = useMutation({
    mutationFn: (values: GameFormValues) =>
      createGame({
        key: values.key,
        name: values.name,
        dataSourceUrl: values.dataSourceUrl,
        isActive: values.isActive,
        fieldDefinitions: toFieldDefinitions(values.fieldDefinitions),
      }),
    onSuccess: (r) => {
      if (!r.success || !r.data) {
        toast.error(r.message || "Failed to create game");
        return;
      }
      setGames([...(gamesQuery.data ?? []), r.data]);
      toast.success(`Created ${r.data.name}`);
    },
    onError: () => toast.error("Failed to create game"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ guid, values }: { guid: string; values: GameFormValues }) =>
      updateGame(guid, {
        key: values.key,
        name: values.name,
        dataSourceUrl: values.dataSourceUrl,
        isActive: values.isActive,
        fieldDefinitions: toFieldDefinitions(values.fieldDefinitions),
      }),
    onSuccess: (r) => {
      if (!r.success || !r.data) {
        toast.error(r.message || "Failed to update game");
        return;
      }
      setGames(
        (gamesQuery.data ?? []).map((g) => (g.guid === r.data!.guid ? r.data! : g)),
      );
      toast.success(`Saved ${r.data.name}`);
    },
    onError: () => toast.error("Failed to update game"),
  });

  const deleteMutation = useMutation({
    mutationFn: (guid: string) => deleteGame(guid),
    onSuccess: (r, guid) => {
      if (!r.success) {
        toast.error(r.message || "Failed to delete game");
        return;
      }
      setGames((gamesQuery.data ?? []).filter((g) => g.guid !== guid));
      toast.success("Game deleted");
    },
    onError: () => toast.error("Failed to delete game"),
  });

  async function handleSubmit(values: GameFormValues) {
    if (formGame) {
      await updateMutation.mutateAsync({ guid: formGame.guid, values });
    } else {
      await createMutation.mutateAsync(values);
    }
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Games</p>
          <p className="text-xs text-muted-foreground">
            Configure which trading card games can be scanned into and how
            their cards are matched against bin rules.
          </p>
        </div>
        <Button size="sm" onClick={() => setFormGame(null)}>
          <IconPlus size={14} />
          Add game
        </Button>
      </div>

      <div className="divide-y">
        {gamesQuery.isLoading && (
          <p className="text-xs text-muted-foreground text-center py-6">
            Loading...
          </p>
        )}
        {gamesQuery.data?.map((game) => (
          <div key={game.guid} className="flex items-center gap-3 px-4 py-2.5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">{game.name}</p>
                <Badge variant={game.isActive ? "success" : "outline"}>
                  {game.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {game.key} · {game.fieldDefinitions.length} field
                {game.fieldDefinitions.length === 1 ? "" : "s"} ·{" "}
                {game.dataSourceUrl}
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setFormGame(game)}
              title="Edit"
            >
              <IconPencil size={14} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setDeleteTarget(game)}
              title="Delete"
            >
              <IconTrash size={14} />
            </Button>
          </div>
        ))}
        {gamesQuery.data?.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">
            No games configured yet
          </p>
        )}
      </div>

      <GameFormDialog
        open={formGame !== undefined}
        onOpenChange={(open) => {
          if (!open) setFormGame(undefined);
        }}
        game={formGame}
        onSubmit={handleSubmit}
      />

      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete game"
        description={`Permanently delete "${deleteTarget?.name}"? Collections using this game will keep their scanned cards, but no new cards can be matched against it.`}
        confirm={{ type: "name", name: deleteTarget?.name ?? "" }}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.guid);
        }}
      />
    </div>
  );
}
