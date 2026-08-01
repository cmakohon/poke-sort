import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldMeta, Game } from "@magic-vault/shared";
import { useEffect } from "react";
import { Controller, FormProvider, useForm } from "react-hook-form";
import { z } from "zod";
import { DEFAULT_OPERATORS_BY_TYPE } from "../constants/field-operators";
import { GameFieldDefinitionsEditor } from "./game-field-definitions-editor";

const fieldMetaFormSchema = z.object({
  field: z.string().min(1, "Required"),
  label: z.string().min(1, "Required"),
  type: z.enum(["string", "numeric", "enum", "set"]),
  path: z.string().min(1, "Required"),
  optionsText: z.string().optional(),
});

const gameFormSchema = z.object({
  key: z
    .string()
    .min(1, "Required")
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and hyphens only"),
  name: z.string().min(1, "Required"),
  dataSourceUrl: z.string().min(1, "Required").url("Must be a valid URL"),
  isActive: z.boolean(),
  fieldDefinitions: z
    .array(fieldMetaFormSchema)
    .min(1, "Add at least one field"),
});

export type GameFormValues = z.infer<typeof gameFormSchema>;

function toFormValues(game?: Game | null): GameFormValues {
  if (!game) {
    return {
      key: "",
      name: "",
      dataSourceUrl: "",
      isActive: true,
      fieldDefinitions: [],
    };
  }
  return {
    key: game.key,
    name: game.name,
    dataSourceUrl: game.dataSourceUrl,
    isActive: game.isActive,
    fieldDefinitions: game.fieldDefinitions.map((f) => ({
      field: f.field,
      label: f.label,
      type: f.type,
      path: f.path,
      optionsText: f.options?.map((o) => o.value).join(", ") ?? "",
    })),
  };
}

export function toFieldDefinitions(
  values: GameFormValues["fieldDefinitions"],
): FieldMeta[] {
  return values.map((f) => {
    const options = f.optionsText
      ?.split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }));

    return {
      field: f.field.trim(),
      label: f.label.trim(),
      type: f.type,
      path: f.path.trim(),
      operators: DEFAULT_OPERATORS_BY_TYPE[f.type],
      ...(options?.length ? { options } : {}),
    };
  });
}

interface GameFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  game?: Game | null;
  onSubmit: (values: GameFormValues) => Promise<void>;
}

export function GameFormDialog({
  open,
  onOpenChange,
  game,
  onSubmit,
}: GameFormDialogProps) {
  const form = useForm<GameFormValues>({
    resolver: zodResolver(gameFormSchema),
    defaultValues: toFormValues(game),
  });
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = form;

  useEffect(() => {
    if (open) reset(toFormValues(game));
  }, [open, game, reset]);

  async function handleFormSubmit(values: GameFormValues) {
    await onSubmit(values);
    onOpenChange(false);
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="sm:max-w-2xl flex flex-col">
        <FormProvider {...form}>
          <form
            onSubmit={handleSubmit(handleFormSubmit)}
            className="flex flex-col min-h-0 flex-1 overflow-hidden"
          >
            <DrawerHeader>
              <DrawerTitle>
                {game ? `Edit ${game.name}` : "Add game"}
              </DrawerTitle>
              <DrawerDescription>
                Define how cards for this game are fetched and which fields
                bin rules can filter on.
              </DrawerDescription>
            </DrawerHeader>

            <div className="flex flex-col gap-4 px-4 shrink-0">
              <div className="grid grid-cols-2 gap-3">
                <Field data-invalid={!!errors.key}>
                  <FieldLabel>Key</FieldLabel>
                  <Input
                    placeholder="pokemon"
                    {...register("key")}
                    disabled={!!game}
                  />
                  <FieldError errors={[errors.key]} />
                </Field>
                <Field data-invalid={!!errors.name}>
                  <FieldLabel>Name</FieldLabel>
                  <Input placeholder="Pokémon" {...register("name")} />
                  <FieldError errors={[errors.name]} />
                </Field>
              </div>

              <Field data-invalid={!!errors.dataSourceUrl}>
                <FieldLabel>Data source URL</FieldLabel>
                <Input
                  placeholder="https://api.pokemontcg.io/v2/cards"
                  {...register("dataSourceUrl")}
                />
                <FieldError errors={[errors.dataSourceUrl]} />
              </Field>

              <Field orientation="horizontal">
                <FieldLabel>Active</FieldLabel>
                <Controller
                  control={control}
                  name="isActive"
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </Field>
            </div>

            <ScrollArea className="flex-1 min-h-0 overflow-y-auto px-4 mt-4">
              <GameFieldDefinitionsEditor />
            </ScrollArea>

            <DrawerFooter className="shrink-0 flex-row justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? "Saving…"
                  : game
                    ? "Save changes"
                    : "Create game"}
              </Button>
            </DrawerFooter>
          </form>
        </FormProvider>
      </DrawerContent>
    </Drawer>
  );
}
