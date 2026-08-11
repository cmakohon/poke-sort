import type { SyncState } from "@poke-sort/shared";

export const DEFAULT_SYNC_STATE: SyncState = {
  status: "idle",
  gameKey: "",
  lang: "en",
  total: 0,
  processed: 0,
  skipped: 0,
  errors: 0,
  startedAt: null,
  logs: [],
};

export { LANGUAGE_LABELS } from "@/lib/languages";

export const STATUS_COLORS: Record<SyncState["status"], string> = {
  idle: "var(--muted-foreground)",
  running: "oklch(0.623 0.214 259.815)",
  completed: "oklch(0.696 0.17 162.48)",
  failed: "oklch(0.637 0.237 25.331)",
  cancelled: "oklch(0.795 0.184 86.047)",
};

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
