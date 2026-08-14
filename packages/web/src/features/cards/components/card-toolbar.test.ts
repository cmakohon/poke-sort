import type { FieldMeta } from "@poke-sort/shared";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { sortValueLabel } from "./card-toolbar";

// Only the four keys sortValueLabel reaches for.
const LABELS: Record<string, string> = {
  "cardToolbar.scanOrder": "Scan order",
  "cardToolbar.sortAscString": "A–Z",
  "cardToolbar.sortDescString": "Z–A",
  "cardToolbar.sortAscDefault": "Low to high",
  "cardToolbar.sortDescDefault": "High to low",
};
const t = ((key: string) => LABELS[key] ?? key) as unknown as TFunction<"cards">;

const FIELDS = [
  { field: "name", label: "Name", type: "string" },
  { field: "rarity", label: "Rarity", type: "enum" },
  // A field name containing a dash — the reason the split is on the LAST one.
  { field: "collector-number", label: "Collector №", type: "numeric" },
] as FieldMeta[];

describe("sortValueLabel", () => {
  it("names the default scan order", () => {
    expect(sortValueLabel("scan-desc", FIELDS, t)).toBe("Scan order");
  });

  it("uses alphabetical wording for string fields", () => {
    expect(sortValueLabel("name-asc", FIELDS, t)).toBe("Name (A–Z)");
    expect(sortValueLabel("name-desc", FIELDS, t)).toBe("Name (Z–A)");
  });

  it("uses magnitude wording for numeric and enum fields", () => {
    expect(sortValueLabel("rarity-asc", FIELDS, t)).toBe("Rarity (Low to high)");
  });

  // Splitting on the first dash would look up "collector" and find nothing,
  // dropping the trigger back to the placeholder.
  it("splits on the last dash so dashed field names still resolve", () => {
    expect(sortValueLabel("collector-number-desc", FIELDS, t)).toBe(
      "Collector № (High to low)",
    );
  });

  it("falls back to the placeholder for an unknown or absent key", () => {
    expect(sortValueLabel(null, FIELDS, t)).toBeUndefined();
    expect(sortValueLabel("gone-asc", FIELDS, t)).toBeUndefined();
  });
});
