import { FIELD_DEFINITIONS } from "./constants/sort-bins.constant";
import type {
  BinCondition,
  BinConfig,
  BinRuleGroup,
  FieldMeta,
} from "./interfaces/sort-bins.interface";
import { isRuleGroup } from "./interfaces/sort-bins.interface";

export type SourceCard = Record<string, unknown>;

export function getByPath(card: SourceCard, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value && typeof value === "object" && key in value) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  }, card);
}

function getCardValue(
  card: SourceCard,
  field: BinCondition["field"],
  fieldDefinitions: FieldMeta[],
): string | number | string[] {
  const meta = fieldDefinitions.find((f) => f.field === field);
  if (!meta) return "";

  const raw = getByPath(card, meta.path);
  if (meta.type === "numeric") {
    return typeof raw === "number" ? raw : parseFloat(String(raw ?? "0")) || 0;
  }
  if (Array.isArray(raw)) return raw as string[];
  return raw === undefined || raw === null ? "" : (raw as string | number);
}

function evaluateCondition(
  card: SourceCard,
  condition: BinCondition,
  fieldDefinitions: FieldMeta[],
): boolean {
  const cardValue = getCardValue(card, condition.field, fieldDefinitions);
  const { operator, value } = condition;

  switch (operator) {
    case "equals":
      if (Array.isArray(cardValue) && Array.isArray(value)) {
        return (
          cardValue.length === value.length &&
          cardValue.every((v) => value.includes(v)) &&
          value.every((v) => cardValue.includes(v))
        );
      }
      return String(cardValue) === String(value);

    case "not_equals":
      if (Array.isArray(cardValue) && Array.isArray(value)) {
        return !(
          cardValue.length === value.length &&
          cardValue.every((v) => value.includes(v)) &&
          value.every((v) => cardValue.includes(v))
        );
      }
      return String(cardValue) !== String(value);

    case "contains":
      return String(cardValue)
        .toLowerCase()
        .includes(String(value).toLowerCase());

    case "not_contains":
      return !String(cardValue)
        .toLowerCase()
        .includes(String(value).toLowerCase());

    case "gt":
      return Number(cardValue) > Number(value);

    case "gte":
      return Number(cardValue) >= Number(value);

    case "lt":
      return Number(cardValue) < Number(value);

    case "lte":
      return Number(cardValue) <= Number(value);

    case "in":
      return Array.isArray(value) && value.includes(String(cardValue));

    case "not_in":
      return Array.isArray(value) && !value.includes(String(cardValue));

    case "contains_any":
      return (
        Array.isArray(cardValue) &&
        Array.isArray(value) &&
        value.some((v) => cardValue.includes(v))
      );

    case "contains_all":
      return (
        Array.isArray(cardValue) &&
        Array.isArray(value) &&
        value.every((v) => cardValue.includes(v))
      );

    case "contains_none":
      return (
        Array.isArray(cardValue) &&
        Array.isArray(value) &&
        !value.some((v) => cardValue.includes(v))
      );

    default:
      return false;
  }
}

function evaluateRuleGroup(
  card: SourceCard,
  group: BinRuleGroup,
  fieldDefinitions: FieldMeta[],
): boolean {
  if (group.conditions.length === 0) return false;

  const results = group.conditions.map((item) =>
    isRuleGroup(item)
      ? evaluateRuleGroup(card, item, fieldDefinitions)
      : evaluateCondition(card, item, fieldDefinitions),
  );

  return group.combinator === "and"
    ? results.every(Boolean)
    : results.some(Boolean);
}

/** Returns the catch-all bin config, if one exists. */
export function getCatchAllBin(configs: BinConfig[]): BinConfig | undefined {
  return configs.find((c) => c.isCatchAll);
}

export function evaluateCardBin(
  card: SourceCard,
  configs: BinConfig[],
  fieldDefinitions: FieldMeta[] = FIELD_DEFINITIONS,
): BinConfig | undefined {
  let catchAll: BinConfig | undefined;

  for (const config of configs) {
    if (config.isCatchAll) {
      catchAll = config;
      continue;
    }
    if (
      config.rules.conditions.length > 0 &&
      evaluateRuleGroup(card, config.rules, fieldDefinitions)
    ) {
      return config;
    }
  }

  return catchAll;
}
