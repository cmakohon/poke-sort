import {
  DEFAULT_ORG_SETTINGS,
  orgSettingsQueryOptions,
  saveOrgSettings,
  type OrgSettings,
} from "@/features/settings/api/org-settings";
import { useOrg } from "@/hooks/use-org";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { NotificationTestType } from "./notification-settings";
import { sendTestNotification } from "./notification-settings";

type NotificationSettingsPatch = Pick<
  OrgSettings,
  "discordWebhookUrl" | "discordNotifyOnScan"
>;

export function useNotificationSettings() {
  const { t } = useTranslation("notifications");
  const queryClient = useQueryClient();
  const { activeOrg } = useOrg();
  const queryOpts = orgSettingsQueryOptions(activeOrg?.id);

  const { data, isLoading } = useQuery(queryOpts);
  const settings = {
    discordWebhookUrl: data?.discordWebhookUrl ?? null,
    discordNotifyOnScan: data?.discordNotifyOnScan ?? false,
  };

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<NotificationSettingsPatch>) =>
      saveOrgSettings(patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryOpts.queryKey });
      const previous = queryClient.getQueryData(queryOpts.queryKey);
      // Spread over DEFAULT_ORG_SETTINGS rather than enumerating fields: the
      // old version listed every key by hand, so a setting added elsewhere
      // silently vanished from the cache whenever a webhook was saved.
      queryClient.setQueryData(queryOpts.queryKey, (old: typeof data): typeof data => ({
        ...DEFAULT_ORG_SETTINGS,
        ...old,
        ...patch,
      }));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryOpts.queryKey, ctx.previous);
      toast.error(t("toasts.saveError"));
    },
    onSuccess: (result) => {
      if (result.success && result.data) {
        queryClient.setQueryData(queryOpts.queryKey, result.data);
        toast.success(t("toasts.saveSuccess"));
      } else {
        toast.error(t("toasts.saveError"));
      }
    },
  });

  const testMutation = useMutation({
    mutationFn: (type: NotificationTestType) => sendTestNotification(type),
    onSuccess: () => toast.success(t("toasts.testSuccess")),
    onError: () => toast.error(t("toasts.testError")),
  });

  return {
    settings,
    isLoading,
    save: (patch: Partial<NotificationSettingsPatch>) =>
      saveMutation.mutateAsync(patch),
    isSaving: saveMutation.isPending,
    sendTest: testMutation.mutate,
    isTesting: testMutation.isPending,
    testingType: testMutation.variables,
  };
}
