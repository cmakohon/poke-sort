import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { IconChevronDown } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export interface PickerOption {
  value: string;
  label: string;
  /** Shown right-aligned — how many catalog cards carry this value. */
  count?: number;
  /** Small leading image, e.g. a set symbol. */
  icon?: string | null;
}

export interface PickerGroup {
  key: string;
  label: string;
  /** Selects/deselects every option in the group at once. */
  options: PickerOption[];
}

/**
 * Multi-select for bin rule values.
 *
 * Two things a plain dropdown could not handle:
 *
 * - Scale. Pokemon has 218 sets and well over a thousand illustrators, so the
 *   list has to be searchable, and long lists are capped rather than rendering
 *   thousands of rows.
 * - Grouping. Sets only make sense under their series — "Scarlet & Violet"
 *   with its 19 sets nested beneath it, so you can pick a whole era or one set.
 */
export function OptionPicker({
  options,
  groups,
  value,
  onChange,
  searchable,
  placeholder,
}: {
  options?: PickerOption[];
  groups?: PickerGroup[];
  value: string[];
  onChange: (value: string[]) => void;
  searchable?: boolean;
  placeholder?: string;
}) {
  const { t } = useTranslation("bins");
  const [query, setQuery] = useState("");

  const MAX_VISIBLE = 200;

  const flat = useMemo(
    () => options ?? groups?.flatMap((g) => g.options) ?? [],
    [options, groups],
  );

  const selectedLabels = flat
    .filter((opt) => value.includes(opt.value))
    .map((opt) => opt.label);

  const matches = (opt: PickerOption) =>
    !query || opt.label.toLowerCase().includes(query.toLowerCase());

  const toggle = (optValue: string) => {
    onChange(
      value.includes(optValue)
        ? value.filter((v) => v !== optValue)
        : [...value, optValue],
    );
  };

  const filteredGroups = groups
    ?.map((g) => ({
      ...g,
      options: g.options.filter(matches),
      // A group whose own name matches should show all its members.
      matchedByName:
        !!query && g.label.toLowerCase().includes(query.toLowerCase()),
    }))
    .map((g) => ({
      ...g,
      options: g.matchedByName
        ? (groups.find((x) => x.key === g.key)?.options ?? g.options)
        : g.options,
    }))
    .filter((g) => g.options.length > 0);

  const filteredOptions = options?.filter(matches).slice(0, MAX_VISIBLE);
  const hiddenCount = options
    ? Math.max(0, options.filter(matches).length - MAX_VISIBLE)
    : 0;

  const row = (opt: PickerOption) => (
    <DropdownMenuCheckboxItem
      key={opt.value}
      checked={value.includes(opt.value)}
      onSelect={(e) => e.preventDefault()}
      onClick={() => toggle(opt.value)}
    >
      <span className="flex items-center gap-2 min-w-0 flex-1">
        {opt.icon && (
          <img
            src={opt.icon}
            alt=""
            aria-hidden
            className="size-4 shrink-0 object-contain"
            loading="lazy"
          />
        )}
        <span className="truncate">{opt.label}</span>
        {opt.count != null && (
          <span className="ml-auto pl-2 text-xs text-muted-foreground tabular-nums">
            {opt.count}
          </span>
        )}
      </span>
    </DropdownMenuCheckboxItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "outline" }), "min-w-24 flex-1")}
      >
        <span className="truncate flex-1 text-left">
          {selectedLabels.length > 0
            ? selectedLabels.join(", ")
            : (placeholder ?? t("conditionRow.selectPlaceholder"))}
        </span>
        <IconChevronDown className="size-4 opacity-50 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-96 overflow-y-auto w-72">
        {searchable && (
          <div className="p-1 sticky top-0 bg-popover z-10">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("conditionRow.searchPlaceholder")}
              className="h-8"
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
        )}

        {filteredGroups?.map((group) => {
          const groupValues = group.options.map((o) => o.value);
          const allSelected = groupValues.every((v) => value.includes(v));
          return (
            <div key={group.key}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel
                className="flex items-center justify-between gap-2 cursor-pointer hover:text-foreground"
                onClick={() =>
                  onChange(
                    allSelected
                      ? value.filter((v) => !groupValues.includes(v))
                      : [...new Set([...value, ...groupValues])],
                  )
                }
              >
                <span className="truncate">{group.label}</span>
                <span className="text-xs font-normal text-muted-foreground shrink-0">
                  {allSelected
                    ? t("conditionRow.clearGroup")
                    : t("conditionRow.selectGroup")}
                </span>
              </DropdownMenuLabel>
              {group.options.map(row)}
            </div>
          );
        })}

        {filteredOptions?.map(row)}

        {hiddenCount > 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("conditionRow.moreResults", { count: hiddenCount })}
          </p>
        )}
        {flat.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("conditionRow.noOptions")}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
