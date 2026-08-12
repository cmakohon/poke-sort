import { useBinConfigs } from "@/features/bins/api/use-bin-configs";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const MODULES = [
  { module: 1, left: 1, right: 2 },
  { module: 2, left: 3, right: 4 },
  { module: 3, left: 5, right: 6 },
] as const;
const OVERFLOW_BIN = 7;

function BinCell({
  binNumber,
  active,
  isCatchAll,
  isReviewBin,
  inverted,
}: {
  binNumber: number;
  active: boolean;
  isCatchAll: boolean;
  isReviewBin: boolean;
  inverted: boolean;
}) {
  const { t } = useTranslation("bins");
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-4 py-2 text-[11px] font-semibold",
        active
          ? "bg-primary text-primary-foreground"
          : inverted
            ? "text-background/70"
            : "text-muted-foreground",
      )}
    >
      <span>{t("binLocationDiagram.binLabel", { number: binNumber })}</span>
      {(isCatchAll || isReviewBin) && (
        <span
          className={cn(
            "text-[8px] font-normal uppercase tracking-wide",
            active
              ? "text-primary-foreground/80"
              : inverted
                ? "text-background/50"
                : "text-muted-foreground/70",
          )}
        >
          {isCatchAll
            ? t("binLocationDiagram.catchAll")
            : t("binLocationDiagram.reviewBin")}
        </span>
      )}
    </div>
  );
}

interface BinLocationDiagramProps {
  binNumber?: number;
  // Set false when rendering directly on a normal page/card surface rather
  // than inside a dark Tooltip (bg-foreground/text-background) popup.
  inverted?: boolean;
}

export function BinLocationDiagram({
  binNumber,
  inverted = true,
}: BinLocationDiagramProps) {
  const { configs } = useBinConfigs();
  const catchAllBin = configs.find((c) => c.isCatchAll)?.binNumber;
  const reviewBin = configs.find((c) => c.isReviewBin)?.binNumber;

  return (
    <div className="overflow-hidden rounded-lg">
      {MODULES.map(({ module, left, right }) => (
        <div key={module} className="grid grid-cols-2">
          <BinCell
            binNumber={left}
            active={binNumber === left}
            isCatchAll={catchAllBin === left}
            isReviewBin={reviewBin === left}
            inverted={inverted}
          />
          <BinCell
            binNumber={right}
            active={binNumber === right}
            isCatchAll={catchAllBin === right}
            isReviewBin={reviewBin === right}
            inverted={inverted}
          />
        </div>
      ))}
      <BinCell
        binNumber={OVERFLOW_BIN}
        active={binNumber === OVERFLOW_BIN}
        isCatchAll={catchAllBin === OVERFLOW_BIN}
        isReviewBin={reviewBin === OVERFLOW_BIN}
        inverted={inverted}
      />
    </div>
  );
}
