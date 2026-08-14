/**
 * Money formatting.
 *
 * Lived in scan-stats.tsx as a USD-only helper exported from a component file
 * and imported by seven modules. Pricing data carries two currencies — TCGplayer
 * quotes USD, CardMarket quotes EUR — so it needed a home and a second currency.
 *
 * The locale is pinned per currency rather than taken from the UI language.
 * Every other price in the app renders as en-US, and a card reading "$1.23" in
 * the grid but "1,23 $" in the detail panel looks like a bug even though both
 * are correct.
 */
const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
    formatters.set(key, formatter);
  }
  return formatter;
}

export function formatMoney(value: number, currency = "USD"): string {
  const locale = currency === "EUR" ? "de-DE" : "en-US";
  return formatterFor(locale, currency).format(value);
}

export function formatUsd(value: number): string {
  return formatMoney(value, "USD");
}

export function formatEur(value: number): string {
  return formatMoney(value, "EUR");
}
