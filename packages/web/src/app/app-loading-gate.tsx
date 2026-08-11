import { useCollections } from "@/features/collections/api/use-collections";
import { cn } from "@/lib/utils";
import { IconLoader2, IconPigFilled } from "@tabler/icons-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

function AppLoadingScreen({
  className,
  onTransitionEnd,
}: {
  className?: string;
  onTransitionEnd?: () => void;
}) {
  const { t } = useTranslation("common");
  return (
    <div
      className={cn(
        "h-dvh w-dvw flex items-center justify-center bg-muted dark:bg-black relative overflow-hidden",
        className,
      )}
      onTransitionEnd={onTransitionEnd}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-60 rounded-full bg-primary/50 blur-[60px]"
      />
      <div className="flex flex-col items-center gap-3 relative">
        <span className="bg-primary grid size-10 shrink-0 place-items-center rounded-lg text-primary-foreground">
          <IconPigFilled className="size-5" />
        </span>
        <div className="flex items-center gap-2 text-muted-foreground">
          <IconLoader2 size={14} className="animate-spin" />
          <span className="text-xs">{t("loadingGate.loadingVault")}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Shows a full-screen splash only for the app's very first data load. Once
 * that resolves, it fades out over the app content and unmounts for good -
 * background refetches and navigation should use inline/skeleton loading
 * instead. Org resolution used to gate this too; there is only one local org
 * now, so collections are all it waits on.
 */
export function AppLoadingGate({ children }: { children: ReactNode }) {
  const { isLoading: collectionsLoading } = useCollections();
  const isInitialLoading = collectionsLoading;

  const [phase, setPhase] = useState<"loading" | "exiting" | "ready">(
    "loading",
  );
  const [overlayVisible, setOverlayVisible] = useState(true);

  useEffect(() => {
    if (!isInitialLoading && phase === "loading") {
      setPhase("exiting");
    }
  }, [isInitialLoading, phase]);

  useEffect(() => {
    if (phase !== "exiting") return;
    const id = requestAnimationFrame(() => setOverlayVisible(false));
    return () => cancelAnimationFrame(id);
  }, [phase]);

  if (phase === "loading") {
    return <AppLoadingScreen />;
  }

  if (phase === "ready") {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      <AppLoadingScreen
        className={cn(
          "fixed inset-0 z-50 transition-opacity duration-500 ease-out",
          overlayVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onTransitionEnd={() => setPhase("ready")}
      />
    </>
  );
}
