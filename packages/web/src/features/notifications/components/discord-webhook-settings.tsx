import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { IconBrandDiscord } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NotificationTestType } from "../api/notification-settings";
import { useNotificationSettings } from "../api/use-notification-settings";

const TEST_TYPES: NotificationTestType[] = [
  "sorter-error",
  "feeder-empty",
  "card-jam",
  "card-search-error",
  "sync-failure",
];

export function DiscordWebhookSettings() {
  const { t } = useTranslation("notifications");
  const {
    settings,
    isLoading,
    save,
    isSaving,
    sendTest,
    isTesting,
    testingType,
  } = useNotificationSettings();
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    setWebhookUrl(settings.discordWebhookUrl ?? "");
  }, [settings.discordWebhookUrl]);

  const isDirty = webhookUrl !== (settings.discordWebhookUrl ?? "");
  const canTest = !isDirty && !!webhookUrl && !isTesting && !isLoading;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <IconBrandDiscord className="size-4" />
        <Label>{t("discordWebhookSettings.heading")}</Label>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("discordWebhookSettings.description")}{" "}
        <a
          href="https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          {t("discordWebhookSettings.howTo")}
        </a>
      </p>
      <div className="flex gap-2">
        <Input
          placeholder={t("discordWebhookSettings.urlPlaceholder")}
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          disabled={isLoading}
          className="flex-1"
        />
        <Button
          onClick={() => save({ discordWebhookUrl: webhookUrl || null })}
          disabled={!isDirty || isSaving || isLoading}
        >
          {t("discordWebhookSettings.saveButton")}
        </Button>
      </div>
      <label className="flex items-center justify-between gap-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm">
            {t("discordWebhookSettings.notifyToggleLabel")}
          </span>
          <span className="text-xs text-muted-foreground">
            {!settings.discordWebhookUrl && !isLoading
              ? t("discordWebhookSettings.notifyToggleDisabledHint")
              : t("discordWebhookSettings.notifyToggleDescription")}
          </span>
        </span>
        <Switch
          checked={settings.discordNotifyOnScan}
          disabled={isLoading || !settings.discordWebhookUrl}
          onCheckedChange={(checked) => save({ discordNotifyOnScan: checked })}
        />
      </label>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">
          {!webhookUrl && !settings.discordWebhookUrl
            ? t("discordWebhookSettings.testHintNoUrl")
            : isDirty
              ? t("discordWebhookSettings.testHintDirty")
              : t("discordWebhookSettings.testHintReady")}
        </Label>
        <div className="flex flex-wrap gap-2">
          {TEST_TYPES.map((type) => (
            <Button
              key={type}
              variant="outline"
              size="sm"
              onClick={() => sendTest(type)}
              disabled={!canTest}
            >
              {isTesting && testingType === type
                ? t("discordWebhookSettings.sending")
                : t(`discordWebhookSettings.testTypes.${type}`)}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
