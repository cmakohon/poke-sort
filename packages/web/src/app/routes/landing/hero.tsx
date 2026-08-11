import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IconArrowRight } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

const CARD_COUNT = 6;
const KNOWN_RARITIES = ["common", "uncommon", "rare", "mythic"];

interface RandomScryfallCard {
  id: string;
  name: string;
  rarity: string;
  image_uris?: { normal: string };
  card_faces?: { name: string; image_uris?: { normal: string } }[];
}

function useRandomCards(count: number) {
  const [cards, setCards] = useState<RandomScryfallCard[]>([]);

  useEffect(() => {
    let cancelled = false;

    Promise.all(
      Array.from({ length: count }, () =>
        fetch("https://api.scryfall.com/cards/random")
          .then((res) =>
            res.ok ? (res.json() as Promise<RandomScryfallCard>) : null,
          )
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      setCards(results.filter((card): card is RandomScryfallCard => !!card));
    });

    return () => {
      cancelled = true;
    };
  }, [count]);

  return cards;
}

export function LandingHero() {
  const { t } = useTranslation("landing");
  const cards = useRandomCards(CARD_COUNT);

  return (
    <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-16 pb-20 md:grid-cols-2 md:pt-24 md:pb-28">
      <div className="flex flex-col items-start gap-5">
        <h1 className="text-4xl font-heading font-semibold leading-tight tracking-tight md:text-5xl">
          <Trans
            t={t}
            i18nKey="hero.title"
            components={{
              br: <br />,
              highlight: <span className="text-primary" />,
            }}
          />
        </h1>
        <p className="max-w-md text-sm/relaxed text-muted-foreground md:text-base/relaxed">
          {t("hero.subtitle")}
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Link
            to="/app"
            className={cn(buttonVariants({ variant: "default", size: "lg" }))}
          >
            {t("hero.getStartedFree")}
            <IconArrowRight size={16} />
          </Link>
          <a
            href="#how-it-works"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          >
            {t("hero.seeHowItWorks")}
          </a>
        </div>
      </div>

      <div className="relative">
        <div className="absolute inset-0 -z-10 rounded-3xl bg-primary/10 blur-2xl" />
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t("hero.currentSession")}
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              {t("hero.cardCount", { count: CARD_COUNT })}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: CARD_COUNT }).map((_, i) => {
              const card = cards[i];
              const image = card
                ? (card.image_uris ?? card.card_faces?.[0]?.image_uris)?.normal
                : undefined;
              const rarity =
                card && KNOWN_RARITIES.includes(card.rarity)
                  ? card.rarity
                  : "common";

              return (
                <div
                  key={card?.id ?? i}
                  className="flex aspect-5/7 flex-col justify-between rounded-lg border bg-secondary/40 p-2"
                >
                  <div
                    className="h-full w-full rounded-md bg-linear-to-br from-muted to-secondary bg-cover bg-center"
                    style={
                      image ? { backgroundImage: `url(${image})` } : undefined
                    }
                  />
                  <div className="flex items-center gap-1 pt-1.5">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: `var(--${rarity})` }}
                    />
                    <p className="truncate text-[0.6rem] font-medium">
                      {card ? (card.card_faces?.[0]?.name ?? card.name) : " "}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
