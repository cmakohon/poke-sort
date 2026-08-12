import { useBinConfigs } from "@/features/bins/api/use-bin-configs";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

// Physical layout as seen from the front of the machine (feeder toward you),
// verified against the hardware 2026-08-12: each module's even bin sits on the
// operator's LEFT, the odd bin on the right. The firmware's "push right"
// naming is from the machine's own perspective, which is mirrored from the
// operator's — render what the operator sees, not what the firmware calls it.
const MODULES = [
  { module: 1, left: 2, right: 1 },
  { module: 2, left: 4, right: 3 },
  { module: 3, left: 6, right: 5 },
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
  const { t } = useTranslation("bins");
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
      <p
        className={cn(
          "px-2 py-1 text-center text-[9px]",
          inverted ? "text-background/50" : "text-muted-foreground/70",
        )}
      >
        {t("binLocationDiagram.viewpoint")}
      </p>
    </div>
  );
}
