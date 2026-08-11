import { useBinConfigs } from "@/features/bins/api/use-bin-configs";
import { cn } from "@/lib/utils";
import {
  evaluateCardBin,
  getCardValue,
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
}

function formatValue(value: string | number | string[]): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "";
  return String(value ?? "");
}

export function CardMetadataPanel({
  card,
  assignedBin,
  needsReview,
  scanScore,
  scanMargin,
}: CardMetadataPanelProps) {
  const { t } = useTranslation("cards");
  const { configs, fieldDefinitions } = useBinConfigs();
  const [showRaw, setShowRaw] = useState(false);

  const rows = useMemo(
    () =>
      fieldDefinitions.map((meta) => ({
        label: meta.label,
        value: formatValue(getCardValue(card, meta.field, fieldDefinitions)),
      })),
    [card, fieldDefinitions],
  );

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

      <div className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <span className="text-muted-foreground whitespace-nowrap">
              {row.label}
            </span>
            <span
              className={cn(
                "min-w-0 break-words",
                row.value === "" && "text-muted-foreground/50 italic",
              )}
            >
              {row.value === "" ? t("metadata.empty") : row.value}
            </span>
          </div>
        ))}
        <div className="contents">
          <span className="text-muted-foreground whitespace-nowrap">
            {t("metadata.variant")}
          </span>
          <span className={cn(!card.variant && "text-muted-foreground/50 italic")}>
            {card.variant ?? t("metadata.empty")}
          </span>
        </div>
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
