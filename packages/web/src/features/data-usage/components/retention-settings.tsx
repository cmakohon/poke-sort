import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOrg } from "@/hooks/use-org";
import {
  DEFAULT_ORG_SETTINGS,
  orgSettingsQueryOptions,
  saveOrgSettings,
} from "@/features/settings/api/org-settings";
import {
  RETENTION_DAY_OPTIONS,
  RETENTION_KEEP_FOREVER,
  RETENTION_KEYS,
  type RetentionKey,
} from "@poke-sort/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

/**
 * The policy behind the numbers above.
 *
 * It sits under the bar rather than in its own settings section because it is
 * the answer to the question the bar provokes — "why did my scans disappear",
 * or "how do I stop this growing" — and separating the two would leave the
 * screen showing a size with no explanation of what happens to it.
 */
export function RetentionSettings() {
  const { t } = useTranslation("settings");
  const { activeOrg } = useOrg();
  const queryClient = useQueryClient();
  const queryOpts = orgSettingsQueryOptions(activeOrg?.id);
  const { data, isLoading } = useQuery(queryOpts);
  const retention = data?.retention ?? DEFAULT_ORG_SETTINGS.retention;

  // Closes over `t` rather than taking it as a parameter: i18next's TFunction
  // is heavily overloaded, and any hand-written signature for it is both wrong
  // and a compile error at the call site.
  const daysLabel = (days: number) =>
    days === RETENTION_KEEP_FOREVER
      ? t("dataUsage.retention.forever")
      : t("dataUsage.retention.days", { count: days });

  const save = useMutation({
    mutationFn: (patch: Partial<Record<RetentionKey, number>>) =>
      saveOrgSettings({ retention: patch }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryOpts.queryKey });
      const previous = queryClient.getQueryData(queryOpts.queryKey);
      queryClient.setQueryData(queryOpts.queryKey, (old: typeof data): typeof data => ({
        ...DEFAULT_ORG_SETTINGS,
        ...old,
        retention: { ...(old?.retention ?? DEFAULT_ORG_SETTINGS.retention), ...patch },
      }));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryOpts.queryKey, ctx.previous);
      toast.error(t("dataUsage.retention.saveError"));
    },
    onSuccess: (result) => {
      if (result.success && result.data) {
        queryClient.setQueryData(queryOpts.queryKey, result.data);
      }
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium">{t("dataUsage.retention.heading")}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("dataUsage.retention.description")}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {RETENTION_KEYS.map((key) => (
          <label key={key} className="flex items-center justify-between gap-3">
            <span className="flex flex-col gap-0.5">
              <span className="text-sm">{t(`dataUsage.retention.${key}.label`)}</span>
              <span className="text-xs text-muted-foreground">
                {t(`dataUsage.retention.${key}.hint`)}
              </span>
            </span>
            <Select
              value={String(retention[key])}
              disabled={isLoading || save.isPending}
              onValueChange={(value) => {
                const days = Number(value);
                if (days !== retention[key]) save.mutate({ [key]: days });
              }}
            >
              <SelectTrigger size="sm" className="w-36 shrink-0">
                <SelectValue>{daysLabel(retention[key])}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {/* The stored value may be outside the preset list — it came
                    from the API, which allows any day count up to ten years.
                    Including it keeps the trigger from showing a blank. */}
                {optionsFor(retention[key]).map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {daysLabel(days)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("dataUsage.retention.appliedAtLaunch")}
      </p>
    </div>
  );
}

function optionsFor(current: number): number[] {
  const options = [...RETENTION_DAY_OPTIONS] as number[];
  if (!options.includes(current)) options.push(current);
  // "Forever" is zero, and zero sorts first — it belongs last, as the option
  // that keeps the most.
  return options.sort((a, b) =>
    a === RETENTION_KEEP_FOREVER ? 1 : b === RETENTION_KEEP_FOREVER ? -1 : a - b,
  );
}
