import { Button } from "@/components/ui/button";
import { CardCollectionView } from "@/features/cards/components/card-collection-view";
import { useCollectionCards } from "@/features/collections/api/use-collection-cards";
import { useCollections } from "@/features/collections/api/use-collections";
import { POKEMON_FIELD_DEFINITIONS } from "@poke-sort/shared";
import { IconAlbum, IconArrowLeft } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router-dom";

/**
 * Looking inside a collection.
 *
 * Until now the only way to see a collection's cards was to make it active and
 * open the scan screen, because the scan screen *was* the collection view. Now
 * that scanning stages into a session instead, collections need a home of
 * their own — and it reuses the same grid the scan screen does.
 */
export default function CollectionDetailPage() {
  const { t } = useTranslation("collections");
  const { collectionGuid } = useParams<{ collectionGuid: string }>();
  const { collections, isLoading: collectionsLoading } = useCollections();
  const collection = collections.find((c) => c.guid === collectionGuid);

  // The collection carries its own game, unlike useBinConfigs().fieldDefinitions
  // which follows the *globally active* game — wrong whenever you are looking
  // at a collection other than the one you are scanning into. Same reason
  // monitor.tsx resolves it this way.
  const fieldDefinitions =
    collection?.game?.fieldDefinitions ?? POKEMON_FIELD_DEFINITIONS;

  const {
    cards,
    isLoading,
    removeCard,
    removeCards,
    correctCard,
    toggleFoil,
    markDownloaded,
    emptyCollection,
  } = useCollectionCards(collectionGuid, fieldDefinitions);

  // Deleted out from under us, or a stale bookmark.
  if (!collectionsLoading && !collection) {
    return <Navigate to="/collections" replace />;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0">
        <Button
          variant="ghost"
          size="icon"
          render={
            <Link to="/collections" aria-label={t("detail.backToCollections")}>
              <IconArrowLeft className="size-4" />
            </Link>
          }
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold font-heading truncate">
            {collection?.name ?? "…"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t("page.cardCount", { count: cards.length })}
            {collection?.game ? ` · ${collection.game.name}` : ""}
            {collection?.lang ? ` · ${collection.lang.toUpperCase()}` : ""}
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto @container flex flex-col">
        <CardCollectionView
          cards={cards}
          fieldDefinitions={fieldDefinitions}
          isLoading={isLoading}
          collectionName={collection?.name}
          searchCollectionGuid={collectionGuid}
          // Deliberately NOT the app-wide CardFilters context: filtering a
          // collection here must not change what the scan screen shows.
          resetPageKey={collectionGuid}
          onRemoveCard={removeCard}
          onRemoveCards={removeCards}
          onCorrectCard={correctCard}
          onToggleFoil={toggleFoil}
          onMarkDownloaded={markDownloaded}
          onClearAll={emptyCollection}
          emptyState={
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground flex-1">
              <IconAlbum className="size-8" />
              <p className="text-sm font-medium">{t("detail.emptyTitle")}</p>
              <p className="text-xs">{t("detail.emptyDescription")}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                render={<Link to="/">{t("detail.goScan")}</Link>}
              />
            </div>
          }
        />
      </div>
    </div>
  );
}
