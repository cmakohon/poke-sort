import { AppLoadingGate } from "@/app/app-loading-gate";
import { BinConfigsProvider } from "@/features/bins/api/use-bin-configs";
import { CardFiltersProvider } from "@/features/cards/api/use-card-filters";
import { FeederConfigProvider } from "@/features/calibration/api/use-feeder-config";
import { ModuleConfigsProvider } from "@/features/calibration/api/use-module-configs";
import { CollectionLocksProvider } from "@/features/collections/api/use-collection-locks";
import { CollectionsProvider } from "@/features/collections/api/use-collections";
import { CameraProvider } from "@/features/scanner/api/use-camera";
import { ScannedCardsProvider } from "@/features/scanner/api/use-scanned-cards";
import { ScannerEngineProvider } from "@/features/scanner/api/use-scanner-engine";
import { SerialProvider } from "@/features/scanner/api/use-serial";
import { DocumentTitleUpdater } from "@/features/scanner/components/document-title-updater";
import { orgSettingsQueryOptions } from "@/features/settings/api/org-settings";
import { useOrg } from "@/hooks/use-org";
import { applyPrimaryColor, resetPrimaryColor, THEME_COLORS } from "@/lib/primary-color";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      retry: 1,
    },
  },
});

function OrgThemeApplier() {
  const { activeOrg } = useOrg();
  const { data } = useQuery(orgSettingsQueryOptions(activeOrg?.id));

  useEffect(() => {
    const color = data?.primaryColor
      ? THEME_COLORS.find((c) => c.name === data.primaryColor)
      : null;
    if (color) {
      applyPrimaryColor(color);
    } else {
      resetPrimaryColor();
    }
  }, [data?.primaryColor]);

  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <OrgThemeApplier />
      <CameraProvider>
        <SerialProvider>
          <CollectionsProvider>
            <BinConfigsProvider>
              <CollectionLocksProvider>
              <ModuleConfigsProvider>
                <FeederConfigProvider>
                  <ScannedCardsProvider>
                    <ScannerEngineProvider>
                      <CardFiltersProvider>
                        <AppLoadingGate>{children}</AppLoadingGate>
                        <DocumentTitleUpdater />
                      </CardFiltersProvider>
                    </ScannerEngineProvider>
                  </ScannedCardsProvider>
                </FeederConfigProvider>
              </ModuleConfigsProvider>
              </CollectionLocksProvider>
            </BinConfigsProvider>
          </CollectionsProvider>
        </SerialProvider>
      </CameraProvider>
    </QueryClientProvider>
  );
}
