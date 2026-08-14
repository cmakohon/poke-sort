import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format-currency";
import { cn } from "@/lib/utils";
import {
  getCardPricing,
  listPrintings,
  resolvePrintingKey,
  tcgplayerProductUrl,
  type PlayingCard,
  type TcgPlayerPrintingKey,
} from "@poke-sort/shared";
import { IconExternalLink } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

/**
 * What a card is worth, broken down by printing.
 *
 * The panel used to show one bare unlabelled number — whichever printing the
 * server happened to resolve — with no way to tell which one it was. That
 * matters most on exactly the cards where it is easiest to get wrong: a reverse
 * holo is routinely worth several times the normal printing of the same card.
 *
 * Everything here comes from data already stored with the card. There is no
 * condition breakdown because TCGdex publishes none; price varies by printing,
 * not by wear.
 */
interface CardPricingPanelProps {
  card: PlayingCard;
  /**
   * Overrides the card's own variant. The detail screen uses it so the
   * reverse-holo toggle re-prices the card as you flip it, without writing a
   * variant the scan never detected.
   */
  variant?: string;
  className?: string;
}

const EM_DASH = "—";

function money(value: number | null | undefined, currency: string): string {
  return value == null ? EM_DASH : formatMoney(value, currency);
}

export function CardPricingPanel({
  card,
  variant,
  className,
}: CardPricingPanelProps) {
  const { t, i18n } = useTranslation("cards");

  const pricing = getCardPricing(card);
  const resolved = resolvePrintingKey(pricing, variant ?? card.variant);
  const printings = listPrintings(pricing);

  const tcg = pricing?.tcgplayer;
  const usd = tcg?.unit ?? "USD";

  const printingName = (key: TcgPlayerPrintingKey) => t(`pricing.printing.${key}`);

  const asOf = (value?: string): string | null => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "medium",
    }).format(date);
  };

  const header = (
    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
      {t("pricing.title")}
    </p>
  );

  const shell = (children: React.ReactNode) => (
    <div
      className={cn("rounded-lg border p-4 flex flex-col gap-3", className)}
    >
      {header}
      {children}
    </div>
  );

  // Plenty of cards carry no TCGplayer pricing. A handful carry only
  // Cardmarket's, which is quoted in euros — deliberately not shown, because
  // there is no exchange rate here to convert it with and a euro figure beside
  // dollar ones invites being read as dollars. Keep the box either way so the
  // three-column layout does not reflow when paging between cards.
  if (!pricing || !resolved) {
    return shell(
      <p className="text-xs text-muted-foreground">{t("pricing.unavailable")}</p>,
    );
  }

  const selected = tcg?.[resolved.key];
  const headlineValue = selected?.marketPrice;

  const others = printings.filter((p) => p.key !== resolved?.key);

  const productId =
    selected?.productId ?? printings.find((p) => p.price.productId)?.price.productId;
  const productUrl = tcgplayerProductUrl(productId);

  const updated = asOf(tcg?.updated);

  return shell(
    <>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-2xl font-semibold tabular-nums">
          {money(headlineValue, usd)}
        </span>
        <span className="text-xs text-muted-foreground">
          {printingName(resolved.key)}
          {resolved.detected && ` · ${t("pricing.detected")}`}
        </span>
      </div>

      {selected && (
        <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
          {(
            [
              ["pricing.low", selected.lowPrice],
              ["pricing.mid", selected.midPrice],
              ["pricing.high", selected.highPrice],
              // TCGplayer Direct: the cheapest copy you can actually buy right
              // now, which is the number that matters when deciding to sell.
              ["pricing.directLow", selected.directLowPrice],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="flex flex-col gap-0.5">
              <span className="text-muted-foreground">{t(key)}</span>
              <span>{money(value, usd)}</span>
            </div>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            {t("pricing.otherPrintings")}
          </span>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-xs">
            {others.map(({ key, price }) => (
              <div key={key} className="contents">
                <span className="min-w-0 truncate">{printingName(key)}</span>
                <span className="tabular-nums">
                  {money(price.marketPrice, usd)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {updated && (
        <p className="text-xs text-muted-foreground">
          {t("pricing.asOf", { date: updated })}
        </p>
      )}

      {productUrl && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          render={
            <a href={productUrl} target="_blank" rel="noopener noreferrer">
              {t("pricing.viewOnTcgplayer")}
              <IconExternalLink className="size-3.5" />
            </a>
          }
        />
      )}
    </>,
  );
}
