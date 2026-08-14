import { LanguageSwitcher } from "@/components/language-switcher";
import { Label } from "@/components/ui/label";
import { PrimaryColorPicker } from "@/components/primary-color-picker";
import { ScannerLayoutToggle } from "@/components/scanner-layout-toggle";
import { DiscordWebhookSettings } from "@/features/notifications/components/discord-webhook-settings";
import { SUPPORTED_LANGUAGES } from "@/lib/i18n";
import { useTranslation } from "react-i18next";

export default function SettingsPage() {
  const { t } = useTranslation("settings");

  return (
    <div className="flex flex-col p-4 md:p-6 max-w-4xl mx-auto w-full h-full overflow-y-auto gap-4">
      <div>
        <h1 className="text-lg font-semibold font-heading">{t("title")}</h1>
        <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
      </div>
      <div className="rounded-lg border p-4 flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">
            {t("appearance.heading")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("appearance.description")}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium">{t("appearance.primaryColor")}</p>
          <PrimaryColorPicker />
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium">{t("appearance.scannerLayout")}</p>
          <ScannerLayoutToggle />
        </div>
        {/* Hidden while English is the only locale: a picker with one entry
            offers no choice. The row comes back on its own the moment a second
            language is added to SUPPORTED_LANGUAGES. */}
        {SUPPORTED_LANGUAGES.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="language-switcher"
              className="text-xs font-medium w-fit"
            >
              {t("appearance.language")}
            </Label>
            <LanguageSwitcher />
          </div>
        )}
      </div>
      <div className="rounded-lg border p-4 flex flex-col gap-4">
        <h2 className="text-base font-semibold">
          {t("notifications.heading")}
        </h2>
        <DiscordWebhookSettings />
      </div>
    </div>
  );
}
