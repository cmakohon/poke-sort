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
import { useOrg } from "@/hooks/use-org";
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
import { IconFolderPlus, IconLoader2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

const EMPTY_LANGUAGES: string[] = [];

export function RequireCollectionDialog() {
  const { t } = useTranslation("collections");
  const { collections, isLoading, isMutating, createCollection } =
    useCollections();
  const { activeOrg } = useOrg();
  const { data: games = [] } = useQuery(gamesQueryOptions);
  const activeGames = games.filter((g) => g.isActive);

  const form = useForm<CreateCollectionFormValues>({
    resolver: zodResolver(createCollectionSchema),
    defaultValues: { name: "", gameGuid: "", lang: "" },
    mode: "onChange",
  });

  useEffect(() => {
    if (!form.getValues("gameGuid") && activeGames[0]) {
      form.setValue("gameGuid", activeGames[0].guid, { shouldValidate: true });
    }
  }, [activeGames, form]);

  const selectedGameGuid = form.watch("gameGuid");
  const { data: rawGameLanguages = EMPTY_LANGUAGES } = useQuery(
    gameLanguagesQueryOptions(selectedGameGuid || undefined),
  );
  const gameLanguages = useMemo(
    () => (rawGameLanguages.length > 0 ? rawGameLanguages : ["en"]),
    [rawGameLanguages],
  );

  // Keyed on the current value, not just on `gameLanguages`.
  //
  // Depending on the array alone made this fire once and never again: the
  // languages query is `staleTime: Infinity`, so its identity is stable for the
  // life of the app, while the form is reset to `lang: ""` every time the
  // dialog opens. From the second open on, the field stayed empty — and because
  // the select disables itself when there is only one language, it could not be
  // filled by hand either, leaving "Language is required" with no way to
  // satisfy it. Watching the value re-runs this whenever it goes blank.
  const currentLang = form.watch("lang");
  useEffect(() => {
    if (!currentLang && gameLanguages.length === 1) {
      form.setValue("lang", gameLanguages[0], { shouldValidate: true });
    }
  }, [currentLang, gameLanguages, form]);

  const handleCreate = useCallback(
    async (values: CreateCollectionFormValues) => {
      await createCollection(values.name, values.gameGuid, values.lang);
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
            <DialogTitle>{t("requireDialog.title")}</DialogTitle>
          </div>
          <DialogDescription>{t("requireDialog.description")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleCreate)} className="flex flex-col gap-4">
          <Controller
            name="name"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="first-collection-name">
                  {t("createDialog.nameLabel")}
                </FieldLabel>
                <Input
                  {...field}
                  id="first-collection-name"
                  placeholder={t("createDialog.namePlaceholder")}
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
                <FieldLabel htmlFor="first-collection-game">
                  {t("createDialog.gameLabel")}
                </FieldLabel>
                <Select
                  value={field.value}
                  onValueChange={(guid) => {
                    field.onChange(guid);
                    form.setValue("lang", "", { shouldValidate: true });
                  }}
                >
                  <SelectTrigger id="first-collection-game">
                    <SelectValue placeholder={t("createDialog.gamePlaceholder")} />
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
          <Controller
            name="lang"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="first-collection-lang">
                  {t("createDialog.langLabel")}
                </FieldLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="first-collection-lang"
                    disabled={gameLanguages.length <= 1}
                  >
                    <SelectValue placeholder={t("createDialog.langPlaceholder")}>
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
            {t("requireDialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
