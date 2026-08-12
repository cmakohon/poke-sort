import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { binsQueryOptions } from "@/features/bins/api/sort-bins";
import { useBinConfigs } from "@/features/bins/api/use-bin-configs";
import { useOrg } from "@/hooks/use-org";
import { BinCard } from "@/features/bins/components/bin-card";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

// Bins arranged as the operator sees them from the front of the machine
// (feeder toward you): each module row has its even bin on the LEFT, odd on
// the right, catch-all position across the bottom. Same convention as
// BinLocationDiagram — change them together or the app argues with itself.
const PHYSICAL_ROWS: ReadonlyArray<readonly number[]> = [
  [2, 1],
  [4, 3],
  [6, 5],
  [7],
];

export function BinList() {
  const { t } = useTranslation("bins");
  const { configs, selectedBin, setSelectedBin, hasCatchAll } = useBinConfigs();
  const { activeOrg } = useOrg();
  const { isLoading } = useQuery({ ...binsQueryOptions, enabled: !!activeOrg });

  if (isLoading) {
    return (
      <ScrollArea>
        <div className="grid grid-cols-2 gap-2">
          {PHYSICAL_ROWS.flat().map((binNumber) => (
            <Skeleton
              key={binNumber}
              className={binNumber === 7 ? "h-13 col-span-2" : "h-13"}
            />
          ))}
        </div>
      </ScrollArea>
    );
  }

  const byNumber = new Map(configs.map((c) => [c.binNumber, c]));

  return (
    <div className="flex flex-col gap-2">
      <ScrollArea>
        <div className="grid grid-cols-2 gap-2">
          {PHYSICAL_ROWS.flat().map((binNumber) => {
            const config = byNumber.get(binNumber);
            if (!config) return null;
            return (
              <div
                key={binNumber}
                className={binNumber === 7 ? "col-span-2" : undefined}
              >
                <BinCard
                  config={config}
                  active={config.binNumber === selectedBin}
                  onClick={() => setSelectedBin(config.binNumber)}
                />
              </div>
            );
          })}
        </div>
      </ScrollArea>
      <p className="text-center text-[10px] text-muted-foreground/70">
        {t("binList.viewpoint")}
      </p>
      {!hasCatchAll && (
        <p className="text-xs text-destructive">
          {t("binList.needCatchAll")}
        </p>
      )}
    </div>
  );
}
