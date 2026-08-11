import { BinConfigPanel } from "@/features/bins/components/bin-config-panel";
import { BinList } from "@/features/bins/components/bin-list";
import { PresetSelector } from "@/features/bins/components/preset-selector";

/**
 * The machine's sorting configuration.
 *
 * Top-level rather than nested under a collection: the machine runs one sort at
 * a time and the others are saved presets, so a sort is not a property of what
 * is being sorted. It previously lived at /collections/:guid/bins, which
 * promised per-collection sorts the model never had — every collection of a
 * game shared the same active set regardless of which one you opened it from.
 *
 * BinConfigsProvider is mounted app-wide in providers.tsx, so this page needs
 * no provider of its own; the scanner reads the same active sort.
 */
export default function SortsPage() {
  return (
    <div className="grid grid-cols-12 flex-1 min-h-0 overflow-hidden">
      <section className="col-span-4 lg:col-span-3 overflow-hidden flex flex-col h-full border-r p-2 gap-2 bg-sidebar/70">
        <PresetSelector />
        <BinList />
      </section>
      <section className="col-span-8 lg:col-span-9 overflow-y-auto max-h-full @container p-4">
        <BinConfigPanel />
      </section>
    </div>
  );
}
