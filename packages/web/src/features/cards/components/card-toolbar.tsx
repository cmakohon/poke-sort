import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { DynamicDialog } from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WatcherStack } from "@/components/ui/watcher-stack";
import { CardFilterPopover } from "@/features/cards/components/card-filter-popover";
import type { CardToolbarProps } from "@/features/cards/types";
import type { FieldMeta } from "@poke-sort/shared";
import { IconCheckbox, IconDownload, IconTrash } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";

// Numeric/enum fields both have a defined "low to high" order (a numeric
// value, or a field's own `options` order); string fields sort
// alphabetically. See compareByField in use-card-filter-sort.ts.
function sortLabels(
  type: FieldMeta["type"],
  t: TFunction<"cards">,
): [asc: string, desc: string] {
  return type === "string"
    ? [t("cardToolbar.sortAscString"), t("cardToolbar.sortDescString")]
    : [t("cardToolbar.sortAscDefault"), t("cardToolbar.sortDescDefault")];
}

/**
 * The trigger's label for the current sort key.
 *
 * Base UI's SelectValue renders the raw value unless it is given children, and
 * the value here is a composite like "collectorNumber-asc". Split on the LAST
 * dash, matching splitSortKey in use-card-filter-sort.ts — field names can
 * contain dashes, the direction suffix cannot.
 */
export function sortValueLabel(
  sortKey: string | null,
  sortableFields: FieldMeta[],
  t: TFunction<"cards">,
): string | undefined {
  if (!sortKey) return undefined;
  if (sortKey === "scan-desc") return t("cardToolbar.scanOrder");
  const i = sortKey.lastIndexOf("-");
  const field = sortableFields.find((f) => f.field === sortKey.slice(0, i));
  if (!field) return undefined;
  const [asc, desc] = sortLabels(field.type, t);
  return `${field.label} (${sortKey.slice(i + 1) === "asc" ? asc : desc})`;
}

export function CardToolbar({
  searchQuery,
  onSearchChange,
  sortKey,
  onSortChange,
  sortableFields,
  onExport,
  onClearAll,
  hasCards,
  activeFilters,
  onFiltersChange,
  activeFilterCount,
  watchers,
  allSelected,
  onToggleSelectAll,
  availableRarities,
  availableTypes,
  availableSets,
}: CardToolbarProps) {
  const { t } = useTranslation("cards");
  const [isClearing, setIsClearing] = useState(false);
  const [clearAllDialogOpen, setClearAllDialogOpen] = useState(false);

  const handleClear = async () => {
    setIsClearing(true);
    try {
      await onClearAll?.();
      setClearAllDialogOpen(false);
    } catch (error) {
      // Stay open on failure. Dismissing used to happen in a finally, so a
      // clear that failed server-side still looked like it had worked — for a
      // destructive action, on a list that only reverts on the next refetch.
      console.error("Failed to clear cards:", error);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="flex flex-row gap-2 items-center w-full">
      {watchers && watchers.length > 0 && <WatcherStack watchers={watchers} />}
      <Input
        placeholder={t("cardToolbar.searchPlaceholder")}
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="flex-1"
      />
      <Select value={sortKey} onValueChange={onSortChange}>
        <SelectTrigger className="w-full sm:w-64">
          <SelectValue placeholder={t("cardToolbar.sortPlaceholder")}>
            {sortValueLabel(sortKey, sortableFields, t)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="scan-desc">{t("cardToolbar.scanOrder")}</SelectItem>
          {sortableFields.map((field) => {
            const [asc, desc] = sortLabels(field.type, t);
            return (
              <Fragment key={field.field}>
                <SelectItem value={`${field.field}-asc`}>
                  {field.label} ({asc})
                </SelectItem>
                <SelectItem value={`${field.field}-desc`}>
                  {field.label} ({desc})
                </SelectItem>
              </Fragment>
            );
          })}
        </SelectContent>
      </Select>
      <CardFilterPopover
        activeFilters={activeFilters}
        onFiltersChange={onFiltersChange}
        activeFilterCount={activeFilterCount}
        availableRarities={availableRarities ?? []}
        availableTypes={availableTypes ?? []}
        availableSets={availableSets}
      />
      {onToggleSelectAll && (
        <Button
          variant="outline"
          size="icon"
          onClick={onToggleSelectAll}
          disabled={!hasCards}
          className="shrink-0"
          title={allSelected ? t("cardToolbar.deselectAll") : t("cardToolbar.selectAll")}
        >
          <IconCheckbox className="size-4" />
        </Button>
      )}
      {(onExport || onClearAll) && (
        <ButtonGroup>
          <Button
            variant="outline"
            size="icon"
            onClick={onExport}
            disabled={!hasCards}
            className="shrink-0"
            title={t("cardToolbar.sessionSummaryExport")}
          >
            <IconDownload className="size-4" />
          </Button>
          {/* Gated on the handler, not just present whenever the group is:
              the scan screen supplies onExport but no onClearAll, so an
              ungated trash icon rendered there and confirmed a deletion that
              never happened. */}
          {onClearAll && (
            <DynamicDialog
              open={clearAllDialogOpen}
              onOpenChange={setClearAllDialogOpen}
              title={t("cardToolbar.deleteScannedCardsTitle")}
              description={t("cardToolbar.deleteScannedCardsDescription")}
              trigger={
                <Button
                  variant="outline"
                  size="icon"
                  title={t("cardToolbar.clearAllCardsTitle")}
                >
                  <IconTrash className="size-4" />
                </Button>
              }
              footer={
                <>
                  <Button
                    variant="outline"
                    onClick={() => setClearAllDialogOpen(false)}
                  >
                    {t("cardToolbar.cancel")}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleClear}
                    disabled={isClearing}
                  >
                    {isClearing
                      ? t("cardToolbar.clearing")
                      : t("cardToolbar.clearAll")}
                  </Button>
                </>
              }
              footerClassName="flex-col-reverse md:flex-row"
            />
          )}
        </ButtonGroup>
      )}
    </div>
  );
}
