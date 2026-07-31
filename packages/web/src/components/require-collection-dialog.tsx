import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCollections } from "@/features/collections/api/use-collections";
import { useOrg } from "@/features/companies/api/use-organization";
import { gamesQueryOptions } from "@/features/games/api/games";
import {
  createCollectionSchema,
  type CreateCollectionFormValues,
} from "@/schemas/collections.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconFolderPlus, IconLoader2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { Controller, useForm } from "react-hook-form";

export function RequireCollectionDialog() {
  const { collections, isLoading, isMutating, createCollection } =
    useCollections();
  const { activeOrg } = useOrg();
  const { data: games = [] } = useQuery(gamesQueryOptions);
  const activeGames = games.filter((g) => g.isActive);

  const form = useForm<CreateCollectionFormValues>({
    resolver: zodResolver(createCollectionSchema),
    defaultValues: { name: "", gameGuid: "" },
    mode: "onChange",
  });

  useEffect(() => {
    if (!form.getValues("gameGuid") && activeGames[0]) {
      form.setValue("gameGuid", activeGames[0].guid, { shouldValidate: true });
    }
  }, [activeGames, form]);

  const handleCreate = useCallback(
    async (values: CreateCollectionFormValues) => {
      await createCollection(values.name, values.gameGuid);
      form.reset();
    },
    [createCollection, form],
  );

  const open = !!activeOrg && !isLoading && collections.length === 0;

  return (
    <Dialog open={open}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <IconFolderPlus className="size-5 text-primary" />
            <DialogTitle>Create your first collection</DialogTitle>
          </div>
          <DialogDescription>
            Collections organise your scanned cards. You need at least one
            before you can start scanning.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleCreate)} className="flex flex-col gap-4">
          <Controller
            name="name"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="first-collection-name">
                  Collection name
                </FieldLabel>
                <Input
                  {...field}
                  id="first-collection-name"
                  placeholder="e.g. Commander Collection, Draft Haul…"
                  aria-invalid={fieldState.invalid}
                  autoFocus
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
          <Controller
            name="gameGuid"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="first-collection-game">Game</FieldLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="first-collection-game">
                    <SelectValue placeholder="Select a game..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeGames.map((game) => (
                      <SelectItem key={game.guid} value={game.guid}>
                        {game.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
        </form>

        <DialogFooter>
          <Button
            onClick={form.handleSubmit(handleCreate)}
            disabled={
              !form.formState.isValid || isMutating || activeGames.length === 0
            }
            className="w-full"
          >
            {isMutating && <IconLoader2 className="size-4 animate-spin" />}
            Create Collection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
