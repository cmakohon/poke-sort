import { useBinConfigs } from "@/features/bins/api/use-bin-configs";
import { useGameFacets, type GameFacets } from "@/features/bins/api/use-facets";
import {
  BinCondition,
  BinRuleGroup,
  FieldMeta,
  isRuleGroup,
} from "@poke-sort/shared";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

/**
 * Facet-driven fields (set, series, illustrator…) carry no static `options`,
 * so a rule stores the raw catalog value (e.g. the set id "sv08"). Resolve it
 * to the display label the picker showed, falling back to the raw value only
 * when the facets aren't loaded.
 */
function facetLabel(
  fieldMeta: FieldMeta | undefined,
  value: string,
  facets: GameFacets | undefined,
): string | undefined {
  if (!facets || fieldMeta?.optionsSource !== "facet") return undefined;
  const key = fieldMeta.facetKey ?? fieldMeta.field;

  if (key === "sets") {
    for (const serie of facets.series) {
      const hit = serie.sets.find((s) => s.value === value);
      if (hit) return hit.label;
    }
    return undefined;
  }

  const list = facets[key as keyof GameFacets];
  if (!Array.isArray(list)) return undefined;
  return (list as { value: string; label: string }[]).find(
    (v) => v.value === value,
  )?.label;
}

function formatCondition(
  condition: BinCondition,
  fieldDefinitions: FieldMeta[],
  facets: GameFacets | undefined,
): string {
  const fieldMeta = fieldDefinitions.find((f) => f.field === condition.field);
  const fieldLabel = fieldMeta?.label ?? condition.field;
  const opMeta = fieldMeta?.operators.find(
    (o) => o.value === condition.operator,
  );
  const opLabel = opMeta?.label ?? condition.operator;

  const resolve = (v: string | number | boolean): string => {
    const str = String(v);
    const opt = fieldMeta?.options?.find((o) => o.value === str);
    return opt?.label ?? facetLabel(fieldMeta, str, facets) ?? str;
  };

  let valueStr: string;
  if (Array.isArray(condition.value)) {
    valueStr = condition.value.map(resolve).join(", ");
  } else if (condition.field === "price_usd") {
    // An unset value must not read as a real threshold — Number("") is 0,
    // which would render an unfinished rule as "$0.00".
    const raw = String(condition.value).trim();
    const n = Number(raw);
    valueStr =
      raw !== "" && Number.isFinite(n) ? `$${n.toFixed(2)}` : "—";
  } else {
    valueStr = resolve(condition.value);
  }

  return `${fieldLabel} ${opLabel} ${valueStr}`;
}

function formatGroup(
  group: BinRuleGroup,
  fieldDefinitions: FieldMeta[],
  facets: GameFacets | undefined,
  t: TFunction<"bins">,
): string {
  if (group.conditions.length === 0) return t("ruleSummary.noConditions");

  const parts = group.conditions.map((item) => {
    if (isRuleGroup(item)) {
      return `(${formatGroup(item, fieldDefinitions, facets, t)})`;
    }
    return formatCondition(item, fieldDefinitions, facets);
  });

  const joiner =
    group.combinator === "and"
      ? ` ${t("ruleSummary.and")} `
      : ` ${t("ruleSummary.or")} `;
  return parts.join(joiner);
}

export function RuleSummary({ rules }: { rules: BinRuleGroup }) {
  const { t } = useTranslation("bins");
  const { fieldDefinitions, gameKey, lang } = useBinConfigs();
  const { data: facets } = useGameFacets(gameKey, lang);
  const text = formatGroup(rules, fieldDefinitions, facets, t);

  return (
    <p className="text-xs line-clamp-3 wrap-break-words text-muted-foreground">
      {text}
    </p>
  );
}
