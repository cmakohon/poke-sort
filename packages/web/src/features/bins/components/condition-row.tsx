import type { ConditionRowProps } from "@/features/bins/types";
import {
  CONDITION_NUMERIC_MAX,
  CONDITION_STRING_MAX_LENGTH,
  ConditionField,
  ConditionOperator,
  FieldMeta,
} from "@poke-sort/shared";

import { Button } from "@/components/ui/button";
import { useBinConfigs } from "@/features/bins/api/use-bin-configs";
import { useFieldOptions } from "@/features/bins/api/use-field-options";
import { OptionPicker } from "@/features/bins/components/option-picker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconX } from "@tabler/icons-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

function getFieldMeta(
  field: ConditionField,
  fieldDefinitions: FieldMeta[],
): FieldMeta | undefined {
  return fieldDefinitions.find((f) => f.field === field);
}

export function ConditionRow({
  condition,
  onChange,
  onRemove,
}: ConditionRowProps) {
  const { t } = useTranslation("bins");
  const { fieldDefinitions } = useBinConfigs();
  const fieldMeta = getFieldMeta(condition.field, fieldDefinitions);
  const fieldOptions = useFieldOptions(fieldMeta);

  const handleFieldChange = useCallback(
    (field: ConditionField) => {
      const newMeta = getFieldMeta(field, fieldDefinitions);
      const defaultOp = newMeta?.operators[0]?.value ?? "equals";
      const defaultValue =
        newMeta?.type === "enum" || newMeta?.type === "set" ? [] : "";
      onChange({
        ...condition,
        field,
        operator: defaultOp,
        value: defaultValue,
      });
    },
    [condition, onChange, fieldDefinitions],
  );

  const handleOperatorChange = useCallback(
    (operator: ConditionOperator) => {
      onChange({ ...condition, operator });
    },
    [condition, onChange],
  );

  const handleValueChange = useCallback(
    (value: string | number | string[]) => {
      onChange({ ...condition, value });
    },
    [condition, onChange],
  );

  const renderValueInput = () => {
    if (!fieldMeta) return null;

    // Options come from the catalog when the field asks for it, so pickers
    // reflect the cards actually present rather than a list frozen at seed time.
    const hasChoices = !!fieldOptions.options || !!fieldOptions.groups;

    if ((fieldMeta.type === "enum" || fieldMeta.type === "set") && hasChoices) {
      const isMulti = [
        "in",
        "not_in",
        "contains_any",
        "contains_all",
        "contains_none",
      ].includes(condition.operator);

      const arrValue = Array.isArray(condition.value)
        ? condition.value
        : condition.value
          ? [String(condition.value)]
          : [];

      // Single-value operators reuse the same picker and keep only the last
      // choice, so grouping, search and set symbols work everywhere.
      return (
        <OptionPicker
          options={fieldOptions.options}
          groups={fieldOptions.groups}
          searchable={fieldOptions.searchable}
          value={arrValue}
          onChange={(next) =>
            handleValueChange(
              isMulti ? next : (next[next.length - 1] ?? ""),
            )
          }
        />
      );
    }

    if (fieldMeta.type === "numeric") {
      return (
        <Input
          type="number"
          step="any"
          placeholder="0"
          max={CONDITION_NUMERIC_MAX}
          className="min-w-24 flex-1"
          value={condition.value === "" ? "" : String(condition.value)}
          onChange={(e) => {
            const raw = e.target.value;
            handleValueChange(raw === "" ? "" : Number(raw));
          }}
        />
      );
    }

    return (
      <Input
        type="text"
        placeholder={t("conditionRow.valuePlaceholder")}
        maxLength={CONDITION_STRING_MAX_LENGTH}
        className="min-w-24 flex-1"
        value={String(condition.value)}
        onChange={(e) => handleValueChange(e.target.value)}
      />
    );
  };

  return (
    <div className="flex flex-wrap items-start gap-1.5">
      <Select
        value={condition.field}
        onValueChange={(val) => handleFieldChange(val as ConditionField)}
      >
        <SelectTrigger className="min-w-28">
          <SelectValue>{fieldMeta?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {fieldDefinitions.map((f) => (
            <SelectItem key={f.field} value={f.field}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {fieldMeta && (
        <Select
          value={condition.operator}
          onValueChange={(val) =>
            handleOperatorChange(val as ConditionOperator)
          }
        >
          <SelectTrigger className="min-w-28">
            <SelectValue>
              {
                fieldMeta.operators.find(
                  (op) => op.value === condition.operator,
                )?.label
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {fieldMeta.operators.map((op) => (
              <SelectItem key={op.value} value={op.value}>
                {op.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {renderValueInput()}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        className="shrink-0"
      >
        <IconX />
      </Button>
    </div>
  );
}
