import { useTranslation } from "react-i18next";

const RARITIES = ["common", "uncommon", "rare", "mythic"] as const;

export function LandingRarity() {
  const { t } = useTranslation("landing");

  return (
    <section className="mx-auto max-w-6xl px-4 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
          {t("rarity.heading")}
        </h2>
        <p className="mt-3 text-sm/relaxed text-muted-foreground md:text-base/relaxed">
          {t("rarity.subtitle")}
        </p>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {RARITIES.map((rarity) => (
          <div
            key={rarity}
            className="flex flex-col gap-3 rounded-lg border bg-card p-5"
          >
            <span
              className="size-6 rounded-full"
              style={{ backgroundColor: `var(--${rarity})` }}
            />
            <div>
              <p className="font-heading text-sm font-semibold">
                {t(`rarity.items.${rarity}.label`)}
              </p>
              <p className="mt-1 text-xs/relaxed text-muted-foreground">
                {t(`rarity.items.${rarity}.description`)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
