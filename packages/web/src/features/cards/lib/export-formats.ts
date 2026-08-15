import type {
  FieldMeta,
  PlayingCardWithDistance,
  ScannedCard,
} from "@poke-sort/shared";
import { getCardValue } from "@poke-sort/shared";
import { downloadFile, fileDateSuffix } from "@/lib/download-file";

function csvEscape(val: string): string {
  return val.includes(",") || val.includes('"')
    ? `"${val.replace(/"/g, '""')}"`
    : val;
}

function groupByCardIdAndFoil(
  cards: ScannedCard[],
): Map<
  string,
  { card: PlayingCardWithDistance; quantity: number; isFoil: boolean }
> {
  const grouped = new Map<
    string,
    { card: PlayingCardWithDistance; quantity: number; isFoil: boolean }
  >();
  for (const entry of cards) {
    const isFoil = !!entry.isFoil;
    const key = `${entry.card.id}:${isFoil}`;
    const existing = grouped.get(key);
    if (existing) existing.quantity++;
    else grouped.set(key, { card: entry.card, quantity: 1, isFoil });
  }
  return grouped;
}

function downloadCsv(csv: string, filename: string) {
  downloadFile(csv, filename, "text/csv;charset=utf-8;");
}

/**
 * The only export format.
 *
 * Columns come from the game's own field definitions rather than a fixed
 * header, so the file follows whatever those definitions say instead of some
 * marketplace importer's hardcoded vocabulary.
 */
export function exportToCsv(
  cards: ScannedCard[],
  collection: string,
  fieldDefinitions: FieldMeta[],
) {
  if (cards.length === 0) return;
  const grouped = groupByCardIdAndFoil(cards);
  const headers = ["Quantity", "Foil", ...fieldDefinitions.map((f) => f.label)];
  const rows = Array.from(grouped.values()).map(
    ({ card, quantity, isFoil }) => [
      String(quantity),
      isFoil ? "True" : "False",
      ...fieldDefinitions.map((f) => {
        const value = getCardValue(card, f.field, fieldDefinitions);
        if (Array.isArray(value)) return csvEscape(value.join("; "));
        return csvEscape(String(value));
      }),
    ],
  );
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  downloadCsv(csv, `poke-sort-export-${fileDateSuffix()}-${collection}.csv`);
}
