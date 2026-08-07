import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DynamicDialog } from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCollections } from "@/features/collections/api/use-collections";
import {
  gameLanguagesQueryOptions,
  gamesQueryOptions,
} from "@/features/games/api/games";
import { LANGUAGE_LABELS } from "@/lib/languages";
import {
  createCollectionSchema,
  type CreateCollectionFormValues,
} from "@/schemas/collections.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconLoader2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Controller, useForm } from "react-hook-form";

const EMPTY_LANGUAGES: string[] = [];

interface CreateCollectionDialogProps {
  trigger: (ctx: { disabled: boolean; noGames: boolean }) => ReactElement;
}

export function CreateCollectionDialog({ trigger }: CreateCollectionDialogProps) {
  const { collections, isMutating, createCollection } = useCollections();
  const { data: games = [] } = useQuery(gamesQueryOptions);
  const activeGames = games.filter((g) => g.isActive);
  const [open, setOpen] = useState(false);

  const form = useForm<CreateCollectionFormValues>({
    resolver: zodResolver(createCollectionSchema),
    defaultValues: { name: "", gameGuid: "", lang: "" },
    mode: "onChange",
  });

  const selectedGameGuid = form.watch("gameGuid");
  const { data: rawGameLanguages = EMPTY_LANGUAGES } = useQuery(
    gameLanguagesQueryOptions(selectedGameGuid || undefined),
  );
  const gameLanguages = useMemo(
    () => (rawGameLanguages.length > 0 ? rawGameLanguages : ["en"]),
    [rawGameLanguages],
  );

  useEffect(() => {
    if (gameLanguages.length === 1) {
      form.setValue("lang", gameLanguages[0], { shouldValidate: true });
    }
  }, [gameLanguages, form]);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen);
      if (isOpen) {
        form.reset({
          name: "",
          gameGuid: activeGames[0]?.guid ?? "",
          lang: "",
        });
      } else {
        form.reset();
      }
    },
    [form, activeGames],
  );

  const handleCreate = useCallback(
    async (values: CreateCollectionFormValues) => {
      const isDuplicate = collections.some(
        (c) => c.name.trim().toLowerCase() === values.name.trim().toLowerCase(),
      );
      if (isDuplicate) {
        form.setError("name", {
          type: "manual",
          message: "A collection with this name already exists",
        });
        return;
      }
      await createCollection(values.name, values.gameGuid, values.lang);
      form.reset();
      setOpen(false);
    },
    [createCollection, collections, form],
  );

  return (
    <DynamicDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="New Collection"
      description="Create a new collection to scan cards into."
      trigger={trigger({
        disabled: isMutating || activeGames.length === 0,
        noGames: activeGames.length === 0,
      })}
      footer={
        <>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={form.handleSubmit(handleCreate)}
            disabled={!form.formState.isValid || isMutating}
          >
            {isMutating && <IconLoader2 className="size-4 animate-spin" />}
            Create
          </Button>
        </>
      }
      footerClassName="flex-col-reverse md:flex-row"
    >
      <form
        onSubmit={form.handleSubmit(handleCreate)}
        className="flex flex-col gap-4"
      >
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined}>
              <FieldLabel htmlFor="collection-name">
                Collection name
              </FieldLabel>
              <Input
                {...field}
                id="collection-name"
                placeholder="e.g. Commander Collection, Draft Haul..."
                aria-invalid={fieldState.invalid}
                autoFocus
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="gameGuid"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined}>
              <FieldLabel htmlFor="collection-game">Game</FieldLabel>
              <Select
                value={field.value}
                onValueChange={(guid) => {
                  field.onChange(guid);
                  form.setValue("lang", "", { shouldValidate: true });
                }}
              >
                <SelectTrigger id="collection-game">
                  <SelectValue placeholder="Select a game...">
                    {activeGames.find((g) => g.guid === field.value)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {activeGames.map((game) => (
                    <SelectItem key={game.guid} value={game.guid}>
                      {game.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="lang"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined}>
              <FieldLabel htmlFor="collection-lang">Language</FieldLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id="collection-lang"
                  disabled={gameLanguages.length <= 1}
                >
                  <SelectValue placeholder="Select a language...">
                    {LANGUAGE_LABELS[field.value] ?? field.value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {gameLanguages.map((lang) => (
                    <SelectItem key={lang} value={lang}>
                      {LANGUAGE_LABELS[lang] ?? lang}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </form>
    </DynamicDialog>
  );
}
