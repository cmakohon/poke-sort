import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import { PresetSelector } from "@/features/bins/components/preset-selector";
import { CardGrid } from "@/features/cards/components/card-grid";
import { CollectionSwitcher } from "@/features/collections/components/collection-switcher";
import { orgSettingsQueryOptions } from "@/features/companies/api/org-settings";
import { useOrg } from "@/features/companies/api/use-organization";
import { useScannedCards } from "@/features/scanner/api/use-scanned-cards";
import { CardScanner } from "@/features/scanner/components/card-scanner";
import { GameSwitchAlert } from "@/features/scanner/components/game-switch-alert";
import { ScanStats } from "@/features/scanner/components/scan-stats";
import { ScannerDebug } from "@/features/scanner/components/scanner-debug";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { IconCards } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

function MobileScanner() {
  const { cards } = useScannedCards();

  return (
    <div className="flex-1 min-h-0 relative overflow-hidden">
      <div className="p-2 size-full bg-sidebar flex flex-col gap-2">
        <CardScanner className="flex-1 min-h-0" />
        <GameSwitchAlert />
      </div>
      <Drawer>
        <DrawerTrigger asChild>
          <button
            type="button"
            className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-background/90 backdrop-blur-sm border rounded-full px-4 py-2 text-sm font-medium shadow-lg"
          >
            <IconCards size={16} />
            {cards.length} {cards.length === 1 ? "card" : "cards"}
          </button>
        </DrawerTrigger>
        <DrawerContent>
          <div className="overflow-y-auto p-4 flex flex-col gap-4 max-h-[calc(80vh-2rem)]">
            <div className="flex flex-col gap-2">
              <CollectionSwitcher />
              <PresetSelector readOnly />
            </div>
            <ScanStats />
            <div className="@container">
              <CardGrid />
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

export default function App() {
  const isMobile = useIsMobile();
  const { activeOrg } = useOrg();
  const { data: orgSettings } = useQuery(
    orgSettingsQueryOptions(activeOrg?.id),
  );
  const isVertical = orgSettings?.scannerLayout === "vertical";

  if (isMobile) {
    return <MobileScanner />;
  }

  if (isVertical) {
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <section className="flex items-stretch gap-2 p-2 border-b bg-sidebar/70 shrink-0 h-96">
          <div className="flex flex-col gap-2 min-w-0">
            <CardScanner className="flex-1 min-h-0" />
          </div>
          <ScanStats />
          <div className="flex flex-col gap-2 w-52 shrink-0 overflow-y-auto">
            <CollectionSwitcher />
            <PresetSelector readOnly />
            <ScannerDebug />
            <GameSwitchAlert />
          </div>
        </section>
        <section className="flex-1 min-h-0 overflow-y-auto @container flex flex-col">
          <CardGrid />
        </section>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 flex-1 min-h-0 overflow-hidden">
      <section className="col-span-4 lg:col-span-3 xl:col-span-4 2xl:col-span-2 overflow-hidden flex flex-col h-full p-2 border-r gap-2 bg-sidebar/70">
        <CollectionSwitcher />
        <PresetSelector readOnly />
        <CardScanner className="flex-none" />
        <GameSwitchAlert />
        <ScannerDebug />
        <ScanStats />
      </section>
      <section className="col-span-8 lg:col-span-9 xl:col-span-8 2xl:col-span-10 overflow-y-auto h-full @container flex flex-col">
        <CardGrid />
      </section>
    </div>
  );
}
