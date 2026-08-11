
export type ConditionField = string;

export type ConditionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "not_in"
  | "contains_any"
  | "contains_all"
  | "contains_none";

export interface BinCondition {
  id: string;
  field: ConditionField;
  operator: ConditionOperator;
  value: string | number | string[];
}

export interface BinRuleGroup {
  id: string;
  combinator: "and" | "or";
  conditions: (BinCondition | BinRuleGroup)[];
}

export type FieldType = "string" | "numeric" | "enum" | "set";

export interface FieldMeta {
  field: ConditionField;
  label: string;
  type: FieldType;
  path: string;
  operators: { value: ConditionOperator; label: string }[];
  /** Fixed vocabulary. Also the fallback when a facet list is unavailable. */
  options?: { value: string; label: string }[];
  /**
   * Load the picker's choices from the catalog facets endpoint instead of the
   * fixed list above.
   *
   * Some vocabularies cannot be baked in: there are 218 Pokemon sets and more
   * every quarter, so a hardcoded list is stale on release day. Facets are
   * derived from the rows actually present, which also stops the picker
   * offering values no card in the catalog has.
   *
   * "sets" is rendered specially — grouped under its series, since a flat list
   * of 218 is not usable.
   */
  optionsSource?: "facet";
  /** Which facet list to read; defaults to the field name. */
  facetKey?: string;
}

export function isRuleGroup(
  item: BinCondition | BinRuleGroup,
): item is BinRuleGroup {
  return "combinator" in item && "conditions" in item;
}

export interface BinConfig {
  guid: string;
  binNumber: number;
  rules: BinRuleGroup;
  isCatchAll?: boolean;
}

export interface BinSet {
  guid: string;
  name: string;
  isActive: boolean;
  bins: BinConfig[];
  createdAt: Date;
  updatedAt: Date;
}
