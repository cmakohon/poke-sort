import type { DataUsageCategoryKey } from "@poke-sort/shared";

/**
 * A monochrome ramp over `--foreground`, deliberately not `--chart-1..5`.
 *
 * The chart variables are byte-identical in `:root` and `.dark`, and the darkest
 * two are the dark theme's own `--muted` — so the last segments would vanish
 * against the track in dark mode. `--foreground` is near-black in light and
 * near-white in dark, so an opacity ramp over it is legible in both themes for
 * free, and reads like the macOS Storage bar it is modelled on.
 */
const RAMP = [
  "bg-foreground/90",
  "bg-foreground/70",
  "bg-foreground/55",
  "bg-foreground/42",
  "bg-foreground/32",
  "bg-foreground/24",
  "bg-foreground/16",
  "bg-foreground/10",
] as const;

/**
 * Display order, largest-and-least-actionable first, so the eye lands on the
 * catalog (which explains the bar) and then walks down to the rows with
 * buttons on them.
 */
export const CATEGORY_ORDER: DataUsageCategoryKey[] = [
  "catalog",
  "collection",
  "scanCaptures",
  "scanDiagnostics",
  "machineTelemetry",
  "configHistory",
  "databaseOverhead",
  "otherFiles",
];

export function categoryRamp(key: DataUsageCategoryKey): string {
  const index = CATEGORY_ORDER.indexOf(key);
  return RAMP[index < 0 ? RAMP.length - 1 : index];
}

/** Categories whose row links somewhere the user can actually act. */
export const CATEGORY_LINKS: Partial<Record<DataUsageCategoryKey, string>> = {
  catalog: "/admin",
};

/** Rows that need a sentence explaining what they even are. */
export const CATEGORIES_WITH_HINTS: DataUsageCategoryKey[] = [
  "collection",
  "databaseOverhead",
  "otherFiles",
];
