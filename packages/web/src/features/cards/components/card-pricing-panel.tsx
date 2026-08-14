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
  className?: string;
}

const EM_DASH = "—";

function money(value: number | null | undefined, currency: string): string {
  return value == null ? EM_DASH : formatMoney(value, currency);
}

export function CardPricingPanel({ card, className }: CardPricingPanelProps) {
  const { t, i18n } = useTranslation("cards");

  const pricing = getCardPricing(card);
  const resolved = resolvePrintingKey(pricing, card.variant);
  const printings = listPrintings(pricing);

  const tcg = pricing?.tcgplayer;
  const usd = tcg?.unit ?? "USD";
  const market = pricing?.cardmarket;
  const eur = market?.unit ?? "EUR";

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

  // Plenty of cards carry no pricing at all. Keep the box so the surrounding
  // three-column layout does not reflow when you page between cards.
  if (!pricing || (!resolved && market?.avg == null)) {
    return shell(
      <p className="text-xs text-muted-foreground">{t("pricing.unavailable")}</p>,
    );
  }

  const selected = resolved ? tcg?.[resolved.key] : undefined;
  // Some cards are priced by CardMarket only; headline that rather than nothing.
  const headlineValue = resolved ? selected?.marketPrice : market?.avg;
  const headlineCurrency = resolved ? usd : eur;

  const others = printings.filter((p) => p.key !== resolved?.key);

  // The -holo fields are the right ones for a holo printing, but they are null
  // on plenty of cards, so fall back to the base figures rather than showing
  // nothing.
  const isHolo =
    resolved?.key === "holofoil" || resolved?.key === "reverse-holofoil";
  const trend = (isHolo ? market?.["trend-holo"] : null) ?? market?.trend;
  const avg30 = (isHolo ? market?.["avg30-holo"] : null) ?? market?.avg30;

  const productId =
    selected?.productId ?? printings.find((p) => p.price.productId)?.price.productId;
  const productUrl = tcgplayerProductUrl(productId);

  const updated = asOf(tcg?.updated);

  return shell(
    <>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-2xl font-semibold tabular-nums">
          {money(headlineValue, headlineCurrency)}
        </span>
        {resolved && (
          <span className="text-xs text-muted-foreground">
            {printingName(resolved.key)}
            {resolved.detected && ` · ${t("pricing.detected")}`}
          </span>
        )}
      </div>

      {selected && (
        <div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
          {(
            [
              ["pricing.low", selected.lowPrice],
              ["pricing.mid", selected.midPrice],
              ["pricing.high", selected.highPrice],
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

      {(trend != null || avg30 != null) && (
        <p
          className="text-xs text-muted-foreground"
          title={asOf(market?.updated) ?? undefined}
        >
          {t("pricing.cardmarket")}
          {trend != null && ` · ${t("pricing.trend", { value: money(trend, eur) })}`}
          {avg30 != null && ` · ${t("pricing.avg30", { value: money(avg30, eur) })}`}
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
