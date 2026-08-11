import { rarityColor } from "@/features/cards/lib/rarity-color";
import { Button } from "@/components/ui/button";
import { DynamicPopover } from "@/components/ui/responsive-popover";
import { Slider } from "@/components/ui/slider";
import type { CardFilters } from "@/features/cards/types";
import {
  OptionPicker,
  type PickerGroup,
} from "@/features/bins/components/option-picker";
import type { SetStats } from "@/features/scanner/types";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import { BIN_COUNT } from "@poke-sort/shared";
import {
  IconDownload,
  IconFilter,
  IconHelpCircle,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

const EMPTY_FILTERS: CardFilters = {
  types: [],
  rarities: [],
  bins: [],
  needsAttention: false,
  showDownloaded: false,
  sets: [],
  minMatchPercent: 0,
};

function toggle<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

const chipBase =
  "cursor-pointer border transition-colors rounded text-xs font-bold";
const chipInactive =
  "border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground";

interface CardFilterPopoverProps {
  activeFilters: CardFilters;
  onFiltersChange: (filters: CardFilters) => void;
  activeFilterCount: number;
  availableRarities: { key: string; label: string }[];
  availableTypes: { key: string; label: string; bg: string }[];
  /** Sets present in the loaded cards — never the whole 218-set catalog. */
  availableSets?: SetStats[];
}

export function CardFilterPopover({
  activeFilters,
  onFiltersChange,
  activeFilterCount,
  availableRarities,
  availableTypes,
  availableSets,
}: CardFilterPopoverProps) {
  const { t } = useTranslation("cards");
  const bins = Array.from({ length: BIN_COUNT }, (_, i) => i + 1);

  // Group by series when the cards carry one; otherwise a single flat list.
  const setGroups = useMemo(() => {
    const bySeries = new Map<string, PickerGroup>();
    for (const set of availableSets ?? []) {
      const key = set.serieName ?? "";
      let group = bySeries.get(key);
      if (!group) {
        group = { key: key || "other", label: key || t("cardFilterPopover.otherSets"), options: [] };
        bySeries.set(key, group);
      }
      group.options.push({
        value: set.code,
        label: set.name || set.code,
        count: set.count,
        icon: set.symbol,
      });
    }
    return [...bySeries.values()];
  }, [availableSets, t]);

  const totalSetCount = availableSets?.length ?? 0;

  return (
    <DynamicPopover
      trigger={
        <Button
          variant={activeFilterCount > 0 ? "secondary" : "outline"}
          size="icon"
          className="shrink-0"
        >
          <IconFilter className="size-4" />
        </Button>
      }
      side="bottom"
      align="end"
    >
      <div className="flex flex-col gap-3">
        {availableTypes.length > 0 && (
          <div>
            <p className="text-[11px] font-medium text-muted-foreground tracking-wide mb-1.5 font-heading">
              {t("cardFilterPopover.type")}
            </p>
            <div className="flex flex-col gap-1">
              {availableTypes.map((type) => {
                const active = activeFilters.types.includes(type.key);
                return (
                  <button
                    key={type.key}
                    type="button"
                    onClick={() =>
                      onFiltersChange({
                        ...activeFilters,
                        types: toggle(activeFilters.types, type.key),
                      })
                    }
                    className={cn(
                      chipBase,
                      "flex items-center gap-1.5 px-2 h-7 font-medium",
                      active
                        ? "border-transparent text-background"
                        : chipInactive,
                    )}
                    style={
                      active ? { backgroundColor: type.bg } : undefined
                    }
                  >
                    <span
                      className="size-2 rounded-full shrink-0 border border-border/50"
                      style={{ backgroundColor: type.bg }}
                    />
                    {type.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {availableRarities.length > 0 && (
          <div>
            <p className="text-[11px] font-medium text-muted-foreground tracking-wide mb-1.5 font-heading">
              {t("cardFilterPopover.rarity")}
            </p>
            <div className="flex flex-col gap-1">
              {availableRarities.map((rarity) => {
                const active = activeFilters.rarities.includes(rarity.key);
                return (
                  <button
                    key={rarity.key}
                    type="button"
                    onClick={() =>
                      onFiltersChange({
                        ...activeFilters,
                        rarities: toggle(activeFilters.rarities, rarity.key),
                      })
                    }
                    className={cn(
                      chipBase,
                      "flex items-center gap-1.5 px-2 h-7 font-medium",
                      active
                        ? "border-transparent text-background"
                        : chipInactive,
                    )}
                    style={
                      active
                        ? { backgroundColor: rarityColor(rarity.key) }
                        : undefined
                    }
                  >
                    <span
                      className="size-2 rounded-full shrink-0"
                      style={{ backgroundColor: rarityColor(rarity.key) }}
                    />
                    {rarity.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <p className="text-[11px] font-medium text-muted-foreground tracking-wide mb-1.5 font-heading">
            {t("cardFilterPopover.bin")}
          </p>
          <div className="flex gap-1 flex-wrap">
            {bins.map((bin) => {
              const active = activeFilters.bins.includes(bin);
              return (
                <button
                  key={bin}
                  type="button"
                  onClick={() =>
                    onFiltersChange({
                      ...activeFilters,
                      bins: toggle(activeFilters.bins, bin),
                    })
                  }
                  className={cn(
                    chipBase,
                    "size-7",
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : chipInactive,
                  )}
                >
                  {bin}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() =>
                onFiltersChange({
                  ...activeFilters,
                  bins: toggle(activeFilters.bins, null),
                })
              }
              className={cn(
                chipBase,
                "size-7",
                activeFilters.bins.includes(null)
                  ? "bg-muted-foreground text-background border-muted-foreground"
                  : chipInactive,
              )}
              title={t("cardFilterPopover.unassigned")}
            >
              -
            </button>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-medium text-muted-foreground tracking-wide mb-1.5 font-heading flex items-center justify-between">
            <span>{t("cardFilterPopover.minMatch")}</span>
            <span className="text-foreground font-semibold">
              {activeFilters.minMatchPercent}%
            </span>
          </p>
          <Slider
            min={0}
            max={100}
            step={1}
            value={activeFilters.minMatchPercent}
            onValueChange={(value) =>
              onFiltersChange({
                ...activeFilters,
                minMatchPercent: value,
              })
            }
          />
        </div>

        <div>
          <p className="text-[11px] font-medium text-muted-foreground tracking-wide mb-1.5 font-heading">
            {t("cardFilterPopover.status")}
          </p>
          <button
            type="button"
            onClick={() =>
              onFiltersChange({
                ...activeFilters,
                needsAttention: !activeFilters.needsAttention,
              })
            }
            className={cn(
              chipBase,
              "flex items-center gap-1.5 px-2 h-7",
              activeFilters.needsAttention
                ? "bg-amber-500 text-white border-amber-600"
                : chipInactive,
            )}
          >
            <IconHelpCircle className="size-3.5" />
            {t("cardFilterPopover.needsAttention")}
          </button>
        </div>

        <div>
          <p className="text-[11px] font-medium text-muted-foreground tracking-wide mb-1.5 font-heading">
            {t("cardFilterPopover.downloaded")}
          </p>
          <button
            type="button"
            onClick={() =>
              onFiltersChange({
                ...activeFilters,
                showDownloaded: !activeFilters.showDownloaded,
              })
            }
            className={cn(
              chipBase,
              "flex items-center gap-1.5 px-2 h-7",
              activeFilters.showDownloaded
                ? "bg-primary text-primary-foreground border-primary"
                : chipInactive,
            )}
          >
            <IconDownload className="size-3.5" />
            {t("cardFilterPopover.showDownloadedCards")}
          </button>
        </div>

        {setGroups.length > 0 && (
          <div>
            <p className="text-[11px] font-medium text-muted-foreground tracking-wide mb-1.5 font-heading">
              {t("cardFilterPopover.sets")}
            </p>
            {/* Scoped to the sets actually present in these cards, so the list
                stays short — unlike the bin rule builder, which offers the
                whole catalog. */}
            <OptionPicker
              options={setGroups.length === 1 ? setGroups[0].options : undefined}
              groups={setGroups.length > 1 ? setGroups : undefined}
              searchable={totalSetCount > 12}
              value={activeFilters.sets}
              onChange={(sets) => onFiltersChange({ ...activeFilters, sets })}
              placeholder={t("cardFilterPopover.allSets")}
            />
          </div>
        )}

        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
          >
            {t("cardFilterPopover.resetFilters")}
          </Button>
        )}
      </div>
    </DynamicPopover>
  );
}
