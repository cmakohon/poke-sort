import { BinConfigsProvider } from "@/features/bins/api/use-bin-configs";
import { BinConfigPanel } from "@/features/bins/components/bin-config-panel";
import { BinList } from "@/features/bins/components/bin-list";
import { PresetSelector } from "@/features/bins/components/preset-selector";
import { useParams } from "react-router-dom";

export default function BinsPage() {
  const { collectionGuid } = useParams<{ collectionGuid: string }>();

  const content = (
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

  return (
    <BinConfigsProvider collectionGuid={collectionGuid}>
      {content}
    </BinConfigsProvider>
  );
}
