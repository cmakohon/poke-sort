const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Byte counts the way macOS writes them.
 *
 * Base 1000, not 1024, because Finder and the Storage pane use base 1000 and
 * this screen exists to be compared against them. (`du` and `ls -l` are base
 * 1024, so a shell cross-check has to convert — that is the trade, and it is
 * the right way round: the user reads Finder, not `du`.)
 *
 * Significant digits rather than a fixed precision, so the column stays the
 * same width whether it reads 4.1 MB or 252 MB and never claims a precision
 * the underlying estimate does not have.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1000) return `${Math.max(0, Math.round(bytes))} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${UNITS[unit]}`;
}

/** For counts: "1,842" reads instantly, "1842" does not. */
export function formatCount(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count)) return "—";
  return count.toLocaleString();
}
