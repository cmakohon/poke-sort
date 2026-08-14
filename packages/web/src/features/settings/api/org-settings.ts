import { apiGet, apiPut } from "@/lib/api/client";
import {
  DEFAULT_RETENTION,
  DEFAULT_SCAN_REGION,
  type RetentionSettings,
  type ScanRegion,
} from "@poke-sort/shared";
import { queryOptions } from "@tanstack/react-query";

export interface OrgSettings {
  primaryColor: string | null;
  scannerLayout: "horizontal" | "vertical";
  discordWebhookUrl: string | null;
  discordNotifyOnScan: boolean;
  scanRegion: ScanRegion;
  /** ms between the IR sensor confirming a card and the frame capture. */
  captureSettleDelayMs: number;
  /** How long the app keeps its own telemetry, in days. 0 means forever. */
  retention: RetentionSettings;
}

/**
 * One set of defaults, used by both the query fallback and every optimistic
 * update.
 *
 * They used to be written out twice, which made adding a setting a four-place
 * change — and the two places that enumerate every field are exactly the ones
 * that fail silently when you miss one: an optimistic update built from a
 * partial literal drops whatever it forgot out of the cache, so saving a
 * webhook could quietly blank an unrelated setting until the next refetch.
 */
export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  primaryColor: null,
  scannerLayout: "horizontal",
  discordWebhookUrl: null,
  discordNotifyOnScan: false,
  scanRegion: DEFAULT_SCAN_REGION,
  captureSettleDelayMs: 500,
  retention: { ...DEFAULT_RETENTION },
};

export async function getOrgSettings(): Promise<{
  success: boolean;
  data?: OrgSettings;
}> {
  return apiGet("/api/org-settings");
}

/** Retention is patched key by key, so the patch type has to allow a partial. */
export type OrgSettingsPatch = Partial<
  Omit<OrgSettings, "retention"> & { retention: Partial<RetentionSettings> | null }
>;

export async function saveOrgSettings(
  patch: OrgSettingsPatch,
): Promise<{ success: boolean; data?: OrgSettings }> {
  return apiPut("/api/org-settings", patch);
}

export const orgSettingsQueryOptions = (orgId: string | undefined) =>
  queryOptions({
    queryKey: ["org-settings", orgId],
    queryFn: () => getOrgSettings().then((r) => r.data ?? DEFAULT_ORG_SETTINGS),
    staleTime: Infinity,
    enabled: !!orgId,
  });
