/**
 * Parses a query-string time value: ISO strings and epoch milliseconds both
 * work, garbage returns null. Shared by every read endpoint that takes
 * since/until so the same value works everywhere — the machine-events and
 * scan-events routes each accepting a different subset was a trap for the
 * exact caller these endpoints exist for.
 */
export function parseTimeParam(value: string | undefined): Date | null {
  if (!value) return null;
  const asNumber = Number(value);
  const date = Number.isFinite(asNumber) ? new Date(asNumber) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
