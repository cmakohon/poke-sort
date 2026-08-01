import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { Controller, useFieldArray, useFormContext } from "react-hook-form";
import { FIELD_TYPE_OPTIONS } from "../constants/field-operators";
import type { GameFormValues } from "./game-form-dialog";

export function GameFieldDefinitionsEditor() {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<GameFormValues>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "fieldDefinitions",
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between sticky top-0 z-10 bg-popover pb-1">
        <p className="text-sm font-medium">Field definitions</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            append({
              field: "",
              label: "",
              type: "string",
              path: "",
              optionsText: "",
            })
          }
        >
          <IconPlus size={14} />
          Add field
        </Button>
      </div>

      {errors.fieldDefinitions?.root?.message && (
        <p className="text-xs text-destructive">
          {errors.fieldDefinitions.root.message}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {fields.map((row, index) => (
          <div
            key={row.id}
            className="rounded-lg border p-3 flex flex-col gap-2"
          >
            <div className="grid grid-cols-2 gap-2">
              <Field data-invalid={!!errors.fieldDefinitions?.[index]?.field}>
                <Input
                  placeholder="Field key (e.g. rarity)"
                  {...register(`fieldDefinitions.${index}.field`)}
                />
                <FieldError errors={[errors.fieldDefinitions?.[index]?.field]} />
              </Field>
              <Field data-invalid={!!errors.fieldDefinitions?.[index]?.label}>
                <Input
                  placeholder="Label (e.g. Rarity)"
                  {...register(`fieldDefinitions.${index}.label`)}
                />
                <FieldError errors={[errors.fieldDefinitions?.[index]?.label]} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Controller
                control={control}
                name={`fieldDefinitions.${index}.type`}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <Field data-invalid={!!errors.fieldDefinitions?.[index]?.path}>
                <Input
                  placeholder="Data path (e.g. prices.usd)"
                  {...register(`fieldDefinitions.${index}.path`)}
                />
                <FieldError errors={[errors.fieldDefinitions?.[index]?.path]} />
              </Field>
            </div>
            <Controller
              control={control}
              name={`fieldDefinitions.${index}.type`}
              render={({ field: typeField }) =>
                typeField.value === "enum" || typeField.value === "set" ? (
                  <Input
                    placeholder="Options, comma separated (e.g. common, uncommon, rare)"
                    {...register(`fieldDefinitions.${index}.optionsText`)}
                  />
                ) : (
                  <></>
                )
              }
            />
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(index)}
              >
                <IconTrash size={14} />
              </Button>
            </div>
          </div>
        ))}
        {fields.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            No fields yet — add at least one for bin rules to filter on.
          </p>
        )}
      </div>
    </div>
  );
}
