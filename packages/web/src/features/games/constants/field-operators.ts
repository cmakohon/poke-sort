import type { ConditionOperator, FieldType } from "@magic-vault/shared";

export const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: "string", label: "String" },
  { value: "numeric", label: "Numeric" },
  { value: "enum", label: "Enum" },
  { value: "set", label: "Set" },
];

export const DEFAULT_OPERATORS_BY_TYPE: Record<
  FieldType,
  { value: ConditionOperator; label: string }[]
> = {
  string: [
    { value: "contains", label: "contains" },
    { value: "not_contains", label: "does not contain" },
    { value: "equals", label: "equals" },
    { value: "not_equals", label: "does not equal" },
  ],
  numeric: [
    { value: "equals", label: "equals" },
    { value: "gt", label: "greater than" },
    { value: "gte", label: "greater than or equal" },
    { value: "lt", label: "less than" },
    { value: "lte", label: "less than or equal" },
  ],
  enum: [
    { value: "in", label: "is any of" },
    { value: "not_in", label: "is none of" },
    { value: "equals", label: "equals" },
    { value: "not_equals", label: "does not equal" },
  ],
  set: [
    { value: "contains_any", label: "contains any of" },
    { value: "contains_all", label: "contains all of" },
    { value: "contains_none", label: "contains none of" },
    { value: "equals", label: "is exactly" },
  ],
};
