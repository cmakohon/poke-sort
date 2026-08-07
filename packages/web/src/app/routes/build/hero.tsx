import { Trans, useTranslation } from "react-i18next";

const MODULE_BINS = [
  [1, 2],
  [3, 4],
  [5, 6],
] as const;

export function BuildHero() {
  const { t } = useTranslation("build");

  return (
    <section className="mx-auto max-w-4xl px-4 pt-12 pb-16">
      <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-balance md:text-4xl">
        {t("hero.title")}
      </h1>
      <p className="mt-4 max-w-2xl text-sm/relaxed text-muted-foreground md:text-base/relaxed">
        {t("hero.description", { arduino: "Arduino Uno R4 Minima" })}
      </p>

      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1.5 font-mono text-[11px] text-muted-foreground">
        <span>
          {t("hero.firmwareLabel")}{" "}
          <code className="rounded border border-border bg-muted px-1.5 py-0.5 text-foreground">
            arduino/main/main.ino
          </code>
        </span>
        <span>
          {t("hero.enclosureLabel")}{" "}
          <a
            href="https://github.com/dishwasher-detergent/mault/blob/master/3d%20model/Card%20Sorter.f3d"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-border bg-muted px-1.5 py-0.5 text-foreground hover:bg-secondary"
          >
            <code>3d model/Card Sorter.f3d</code>
          </a>
        </span>
        <span>
          {t("hero.calibrationLabel")}{" "}
          <code className="rounded border border-border bg-muted px-1.5 py-0.5 text-foreground">
            /app/calibrate
          </code>
        </span>
      </div>

      <div className="mt-10 overflow-hidden rounded-lg border bg-card">
        <div className="divide-y divide-border">
          <p className="p-5 text-xs/relaxed text-muted-foreground md:p-6">
            <Trans
              t={t}
              i18nKey="hero.modulesIntro"
              components={[
                <strong
                  key="0"
                  className="font-medium text-foreground"
                />,
                <strong
                  key="1"
                  className="font-medium text-foreground"
                />,
                <strong
                  key="2"
                  className="font-medium text-foreground"
                />,
              ]}
            />
          </p>

          {MODULE_BINS.map((bins, i) => (
            <div
              key={i}
              className="grid grid-cols-[110px_1fr_1fr] divide-x divide-border"
            >
              <div className="flex items-center justify-center bg-secondary/40 px-3 py-3 font-mono text-xs font-medium">
                {t("hero.moduleLabel", { n: i + 1 })}
              </div>
              {bins.map((bin) => (
                <div
                  key={bin}
                  className="flex items-center justify-center dark:bg-primary/15 bg-primary/5 px-3 py-3 font-mono text-xs font-semibold dark:text-primary-foreground text-primary"
                >
                  {t("hero.binLabel", { n: bin })}
                </div>
              ))}
            </div>
          ))}

          <div className="grid grid-cols-[110px_1fr] divide-x divide-border">
            <div className="bg-secondary/20" />
            <div className="flex items-center justify-center gap-2 dark:bg-primary/15 bg-primary/5 px-3 py-3 font-mono text-xs font-semibold dark:text-primary-foreground text-primary">
              {t("hero.binLabel", { n: 7 })}
              <span className="font-sans text-[10px] font-normal dark:text-primary-foreground/70 text-primary/70">
                - {t("hero.bin7Note")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
