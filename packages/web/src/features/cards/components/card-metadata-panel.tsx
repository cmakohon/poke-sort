import { useBinConfigs } from "@/features/bins/api/use-bin-configs";
import { cn } from "@/lib/utils";
import {
  evaluateCardBin,
  getCardValue,
  type FieldMeta,
  type PlayingCardWithDistance,
} from "@poke-sort/shared";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Everything the app knows about a scanned card, in the shape that matters:
 * what the SORTING RULES see.
 *
 * This exists because "the rule didn't catch my card" is undiagnosable from
 * the pretty card view — the rule engine reads paths off the raw upstream
 * object, not the display fields, and the two can disagree in exactly the
 * ways that make a rule miss (a Trainer has no energy type; "Darkness" is not
 * "Dark"; a pre-enrichment scan has no series). Each row here is resolved
 * through the same getCardValue the rule engine uses, so what this shows IS
 * what a rule matches against.
 *
 * The re-evaluation row runs today's active sort against the card. It can
 * disagree with the bin the card was actually sent to — review-tier scans are
 * routed to the catch-all regardless of rules, and rules edited since the
 * scan don't retroactively move cards — and the disagreement being VISIBLE is
 * the point.
 */

interface CardMetadataPanelProps {
  /** Distance is optional: a hand-corrected card never had an embedding match. */
  card: PlayingCardWithDistance | (Omit<PlayingCardWithDistance, "distance"> & { distance?: number });
  /** The bin the card was physically routed to at scan time. */
  assignedBin?: number;
  /** The pipeline held this scan for a human instead of trusting its ranking. */
  needsReview?: boolean;
  scanScore?: number;
  scanMargin?: number;
  /**
   * The game's fields. Optional with a fallback to the active game's, because
   * the active game is right on the scan screen but wrong when browsing a
   * collection of a different one.
   */
  fieldDefinitions?: FieldMeta[];
  /**
   * Fields the caller already renders elsewhere. They fold into a disclosure
   * rather than disappearing — this panel's contract is that it shows the
   * complete rule-engine view, and a field silently missing from it would make
   * "why didn't my rule fire" harder, not easier.
   */
  duplicateFields?: readonly string[];
}

function formatValue(value: string | number | string[]): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "";
  return String(value ?? "");
}

function MetadataRow({
  label,
  value,
  emptyLabel,
}: {
  label: string;
  value: string;
  emptyLabel: string;
}) {
  return (
    <div className="contents">
      <span className="text-muted-foreground whitespace-nowrap">{label}</span>
      <span
        className={cn(
          "min-w-0 break-words",
          value === "" && "text-muted-foreground/50 italic",
        )}
      >
        {value === "" ? emptyLabel : value}
      </span>
    </div>
  );
}

export function CardMetadataPanel({
  card,
  assignedBin,
  needsReview,
  scanScore,
  scanMargin,
  fieldDefinitions: fieldDefinitionsProp,
  duplicateFields,
}: CardMetadataPanelProps) {
  const { t } = useTranslation("cards");
  // `configs` still comes from the hook: a sort belongs to the machine, not to
  // the collection being viewed.
  const { configs, fieldDefinitions: activeFieldDefinitions } = useBinConfigs();
  const fieldDefinitions = fieldDefinitionsProp ?? activeFieldDefinitions;
  const [showRaw, setShowRaw] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);

  const { primaryRows, duplicateRows } = useMemo(() => {
    const duplicates = new Set(duplicateFields ?? []);
    const primary: Array<{ label: string; value: string }> = [];
    const dupes: Array<{ label: string; value: string }> = [];
    for (const meta of fieldDefinitions) {
      const row = {
        label: meta.label,
        value: formatValue(getCardValue(card, meta.field, fieldDefinitions)),
      };
      (duplicates.has(meta.field) ? dupes : primary).push(row);
    }
    return { primaryRows: primary, duplicateRows: dupes };
  }, [card, fieldDefinitions, duplicateFields]);

  const ruleBin = useMemo(
    () => evaluateCardBin(card, configs, fieldDefinitions),
    [card, configs, fieldDefinitions],
  );

  const disagreement =
    assignedBin != null &&
    ruleBin?.binNumber != null &&
    ruleBin.binNumber !== assignedBin;

  return (
    <div className="flex flex-col gap-2 pt-2 border-t">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        {t("metadata.title")}
      </p>

      {/* Label/value pairs flow into 2 and then 3 columns as the panel widens.
          At one column the list ran to twenty-odd rows against a mostly empty
          right half. `contents` rows make each pair two grid cells, so the
          pairs stay glued together as the column count changes. */}
      <div className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] @2xl:grid-cols-[repeat(2,minmax(0,auto)_minmax(0,1fr))] @5xl:grid-cols-[repeat(3,minmax(0,auto)_minmax(0,1fr))] gap-x-4 gap-y-1 text-xs">
        {primaryRows.map((row) => (
          <MetadataRow key={row.label} {...row} emptyLabel={t("metadata.empty")} />
        ))}
        {/* No hardcoded Variant row: POKEMON_FIELD_DEFINITIONS already carries
            a `variant` field resolving the same value, so it was printed twice. */}
        {card.distance != null && (
          <div className="contents">
            <span className="text-muted-foreground whitespace-nowrap">
              {t("metadata.matchDistance")}
            </span>
            <span className="tabular-nums">{card.distance.toFixed(3)}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">{t("metadata.rulesAssign")}</span>
        <span className="font-medium">
          {ruleBin?.binNumber != null
            ? t("metadata.binN", { bin: ruleBin.binNumber }) +
              (ruleBin.isCatchAll ? ` (${t("metadata.catchAll")})` : "")
            : t("metadata.noBin")}
        </span>
        {disagreement && (
          <span className="rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-amber-600 dark:text-amber-400">
            {t("metadata.sentToBin", { bin: assignedBin })}
          </span>
        )}
      </div>

      {needsReview && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {scanScore != null
            ? t("metadata.heldForReviewWithNumbers", {
                score: scanScore.toFixed(2),
                margin: scanMargin != null ? scanMargin.toFixed(2) : "—",
              })
            : t("metadata.heldForReview")}
        </p>
      )}

      {duplicateRows.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowDuplicates((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
          >
            {showDuplicates ? (
              <IconChevronDown className="size-3.5" />
            ) : (
              <IconChevronRight className="size-3.5" />
            )}
            {t("metadata.showDuplicates", { count: duplicateRows.length })}
          </button>
          {showDuplicates && (
            <div className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] @2xl:grid-cols-[repeat(2,minmax(0,auto)_minmax(0,1fr))] @5xl:grid-cols-[repeat(3,minmax(0,auto)_minmax(0,1fr))] gap-x-4 gap-y-1 text-xs">
              {duplicateRows.map((row) => (
                <MetadataRow
                  key={row.label}
                  {...row}
                  emptyLabel={t("metadata.empty")}
                />
              ))}
            </div>
          )}
        </>
      )}

      <button
        type="button"
        onClick={() => setShowRaw((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        {showRaw ? (
          <IconChevronDown className="size-3.5" />
        ) : (
          <IconChevronRight className="size-3.5" />
        )}
        {t("metadata.rawData")}
      </button>
      {showRaw && (
        <pre className="text-[10px] leading-relaxed bg-muted/50 border rounded-md p-2 overflow-x-auto max-h-64 overflow-y-auto">
          {JSON.stringify(card.raw ?? card, null, 2)}
        </pre>
      )}
    </div>
  );
}
