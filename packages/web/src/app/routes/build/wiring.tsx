import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";

function Pin({ children }: { children?: ReactNode }) {
  return (
    <code className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
      {children}
    </code>
  );
}

function MiniTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-100 border-collapse text-xs/relaxed">
        <thead>
          <tr className="bg-secondary/40">
            {columns.map((col) => (
              <th
                key={col}
                className="border-b px-3 py-2 text-left font-mono text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={cn(
                "hover:bg-secondary/30",
                i !== rows.length - 1 && "border-b",
              )}
            >
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BuildWiring() {
  const { t } = useTranslation("build");

  const CHANNEL_MAP: [string, string][] = [
    ["0", t("wiring.channelMap.unused")],
    ["1", t("wiring.channelMap.unused")],
    ["2", t("wiring.channelMap.unused")],
    ["3", t("wiring.channelMap.unused")],
    [
      "4",
      t("wiring.channelMap.modulePart", {
        n: 1,
        part: t("wiring.parts.bottom"),
      }),
    ],
    [
      "5",
      t("wiring.channelMap.modulePart", {
        n: 1,
        part: t("wiring.parts.paddle"),
      }),
    ],
    [
      "6",
      t("wiring.channelMap.modulePart", {
        n: 1,
        part: t("wiring.parts.pusher"),
      }),
    ],
    [
      "7",
      t("wiring.channelMap.modulePart", {
        n: 2,
        part: t("wiring.parts.bottom"),
      }),
    ],
    [
      "8",
      t("wiring.channelMap.modulePart", {
        n: 2,
        part: t("wiring.parts.paddle"),
      }),
    ],
    [
      "9",
      t("wiring.channelMap.modulePart", {
        n: 2,
        part: t("wiring.parts.pusher"),
      }),
    ],
    [
      "10",
      t("wiring.channelMap.modulePart", {
        n: 3,
        part: t("wiring.parts.bottom"),
      }),
    ],
    [
      "11",
      t("wiring.channelMap.modulePart", {
        n: 3,
        part: t("wiring.parts.paddle"),
      }),
    ],
    [
      "12",
      t("wiring.channelMap.modulePart", {
        n: 3,
        part: t("wiring.parts.pusher"),
      }),
    ],
    ["13", t("wiring.channelMap.feeder")],
  ];

  return (
    <section id="wiring" className="mx-auto max-w-4xl px-4 py-16">
      <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
        {t("wiring.heading")}
      </h2>
      <p className="mt-3 max-w-2xl text-sm/relaxed text-muted-foreground">
        <Trans
          t={t}
          i18nKey="wiring.description"
          components={{ pin: <Pin /> }}
        />
      </p>

      <div className="mt-8 flex flex-col gap-8">
        <div>
          <h3 className="mb-2 font-heading text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t("wiring.sections.i2c.title")}
          </h3>
          <MiniTable
            columns={[
              t("wiring.i2cTable.colPcaPin"),
              t("wiring.i2cTable.colArduino"),
            ]}
            rows={[
              [<Pin key="a">SDA</Pin>, <Pin key="b">SDA</Pin>],
              [<Pin key="a">SCL</Pin>, <Pin key="b">SCL</Pin>],
              [t("wiring.i2cTable.vccLogic"), <Pin key="b">5V</Pin>],
              [<Pin key="a">GND</Pin>, <Pin key="b">GND</Pin>],
            ]}
          />
        </div>

        <div>
          <h3 className="mb-2 font-heading text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t("wiring.sections.servoPower.title")}
          </h3>
          <MiniTable
            columns={[
              t("wiring.servoPowerTable.colFrom"),
              t("wiring.servoPowerTable.colTo"),
            ]}
            rows={[
              [
                t("wiring.servoPowerTable.psuPlus"),
                <Trans
                  key="to-plus"
                  t={t}
                  i18nKey="wiring.servoPowerTable.toPositive"
                  components={{ pin: <Pin /> }}
                />,
              ],
              [
                t("wiring.servoPowerTable.psuMinus"),
                <Trans
                  key="to-minus"
                  t={t}
                  i18nKey="wiring.servoPowerTable.toNegative"
                  components={{
                    pin: <Pin />,
                    em: (
                      <em className="text-muted-foreground not-italic" />
                    ),
                  }}
                />,
              ],
            ]}
          />
        </div>

        <div>
          <h3 className="mb-2 font-heading text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t("wiring.sections.irSensors.title")}
          </h3>
          <p className="mb-3 text-xs/relaxed text-muted-foreground">
            <Trans
              t={t}
              i18nKey="wiring.irSensors.description"
              components={{
                strong: <strong className="text-foreground" />,
                pin: <Pin />,
              }}
            />
          </p>
          <MiniTable
            columns={[
              t("wiring.irTable.colSensor"),
              t("wiring.irTable.colPin"),
            ]}
            rows={[
              [
                t("wiring.irTable.moduleGate", { n: 1 }),
                <Pin key="p">D2</Pin>,
              ],
              [
                t("wiring.irTable.moduleGate", { n: 2 }),
                <Pin key="p">D3</Pin>,
              ],
              [
                t("wiring.irTable.moduleGate", { n: 3 }),
                <Pin key="p">D4</Pin>,
              ],
              [t("wiring.irTable.hopperThroat"), <Pin key="p">D5</Pin>],
            ]}
          />
        </div>

        <div>
          <h3 className="mb-2 font-heading text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t("wiring.sections.channelMap.title")}
          </h3>
          <MiniTable
            columns={[
              t("wiring.channelTable.colCh"),
              t("wiring.channelTable.colAssignment"),
            ]}
            rows={CHANNEL_MAP.map(([ch, assignment]) => [
              <span key="ch" className="font-mono tabular-nums">
                {ch}
              </span>,
              assignment,
            ])}
          />
        </div>

        <div>
          <h3 className="mb-2 font-heading text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t("wiring.sections.diagram.title")}
          </h3>
          <img
            src="/instructions/wiring-diagram.png"
            alt={t("wiring.sections.diagram.alt")}
            className="w-full rounded-lg border"
          />
        </div>
      </div>
    </section>
  );
}
