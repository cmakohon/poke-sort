import { useQuery } from "@tanstack/react-query";
import { IconDownload } from "@tabler/icons-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface UpdateInfo {
  version: string;
  url: string;
}

interface UpdatesBridge {
  getAvailable: () => Promise<UpdateInfo | null>;
  openReleasePage: (url: string) => Promise<void>;
}

function bridge(): UpdatesBridge | undefined {
  return (window as unknown as { pokeSort?: { updates?: UpdatesBridge } })
    .pokeSort?.updates;
}

/** Remembers a dismissal per version, so "Later" does not mean "never again". */
const dismissedKey = "poke-sort:update-dismissed";

/**
 * Surfaces a newer release. The shell does the checking — see
 * packages/desktop/src/update-check.ts for why nothing installs itself.
 *
 * Renders nothing in a browser: the bridge only exists inside Electron, and a
 * "download the desktop app" nudge on a page served by that same desktop app
 * would be nonsense.
 */
export function UpdateNotice() {
  const { t } = useTranslation("common");

  const { data: update } = useQuery({
    queryKey: ["desktop-update"],
    queryFn: () => bridge()?.getAvailable() ?? null,
    enabled: Boolean(bridge()),
    // The shell memoises the result for the life of the process, so refetching
    // only costs an IPC round trip — but there is nothing new to learn either.
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (!update) return;
    if (localStorage.getItem(dismissedKey) === update.version) return;

    toast(t("update.toastTitle", { version: update.version }), {
      description: t("update.toastBody", { current: __APP_VERSION__ }),
      duration: Infinity,
      action: {
        label: t("update.download"),
        onClick: () => void bridge()?.openReleasePage(update.url),
      },
      cancel: {
        label: t("update.later"),
        onClick: () => localStorage.setItem(dismissedKey, update.version),
      },
    });
  }, [update, t]);

  if (!update) return null;

  // Stays after the toast is gone: a dismissed update is still an update, and
  // the footer is where this app already puts its version.
  return (
    <button
      type="button"
      onClick={() => void bridge()?.openReleasePage(update.url)}
      className="flex items-center gap-1 text-primary hover:underline"
    >
      <IconDownload className="size-3" />
      {t("update.available", { version: update.version })}
    </button>
  );
}
