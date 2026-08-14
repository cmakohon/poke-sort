import { useBinConfigs } from "@/features/bins/api/use-bin-configs";
import { buildCorrection } from "@/features/cards/lib/apply-correction";
import {
  clearCollectionCards,
  collectionCardsQueryOptions,
  markCollectionCardsDownloaded,
  removeCollectionCard,
  removeCollectionCards,
  setCollectionCardFoil,
  updateCollectionCard,
} from "@/features/collections/api/collections";
import type { FieldMeta, PlayingCard, ScannedCard } from "@poke-sort/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

/**
 * Editing a saved collection, outside the scanner.
 *
 * The scan screen's equivalents live in use-scanned-cards and operate on the
 * open run's staged cards. These hit the same scanId-keyed endpoints — the
 * server never cared which collection the path named — but keep their state in
 * the React Query cache rather than in the scanner context.
 */
export function useCollectionCards(guid: string | undefined, fieldDefinitions: FieldMeta[]) {
  const { t } = useTranslation("collections");
  const queryClient = useQueryClient();
  const { configs: binConfigs } = useBinConfigs();
  const queryKey = ["collection-cards", guid] as const;

  const { data: cards = [], isLoading } = useQuery({
    ...collectionCardsQueryOptions(guid ?? ""),
    enabled: !!guid,
  });

  const patch = useCallback(
    (fn: (prev: ScannedCard[]) => ScannedCard[]) => {
      queryClient.setQueryData<ScannedCard[]>(queryKey, (prev) =>
        prev ? fn(prev) : prev,
      );
    },
    [queryClient, guid], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const removeCard = useCallback(
    (scanId: string) => {
      if (!guid) return;
      patch((prev) => prev.filter((c) => c.scanId !== scanId));
      removeCollectionCard(guid, scanId).catch((err) =>
        console.error("Failed to remove card:", err),
      );
    },
    [guid, patch],
  );

  const removeCards = useCallback(
    (scanIds: string[]) => {
      if (!guid || scanIds.length === 0) return;
      const idSet = new Set(scanIds);
      patch((prev) => prev.filter((c) => !idSet.has(c.scanId)));
      removeCollectionCards(guid, scanIds).catch((err) =>
        console.error("Failed to remove cards:", err),
      );
    },
    [guid, patch],
  );

  const correctCard = useCallback(
    (scanId: string, card: PlayingCard) => {
      if (!guid) return;
      const previous = cards.find((c) => c.scanId === scanId);
      const { corrected, provenance } = buildCorrection(
        previous,
        card,
        binConfigs,
        fieldDefinitions,
      );
      // The bin is deliberately kept, not recomputed. On the scan screen a
      // correction happens while the card is still in the machine, so the new
      // identity should decide where it goes. Here the card was physically
      // sorted long ago and bin_number records where it actually went —
      // recomputing would overwrite a fact with a hypothetical. The review
      // screen leaves bin_number alone for the same reason.
      const binNumber = previous?.binNumber;
      patch((prev) =>
        prev.map((c) =>
          c.scanId === scanId
            ? { ...c, ...provenance, card: corrected, needsReview: undefined }
            : c,
        ),
      );
      updateCollectionCard(guid, scanId, corrected, binNumber, provenance).catch(
        (err) => console.error("Failed to update card:", err),
      );
    },
    [guid, cards, binConfigs, fieldDefinitions, patch],
  );

  const toggleFoil = useCallback(
    (scanId: string, isFoil: boolean) => {
      if (!guid) return;
      // Flip immediately so the switch feels like a switch, then take the
      // server's card back: it re-prices the copy for the printing this flag
      // now claims, and that number belongs to one implementation rather than
      // being derived again here.
      patch((prev) =>
        prev.map((c) => (c.scanId === scanId ? { ...c, isFoil } : c)),
      );
      setCollectionCardFoil(guid, scanId, isFoil)
        .then((result) => {
          if (!result.success || !result.data) return;
          const updated = result.data;
          patch((prev) =>
            // The price lives on the inner card, which is what computeStats
            // and the export both read.
            prev.map((c) =>
              c.scanId === scanId ? { ...c, isFoil, card: updated.card } : c,
            ),
          );
          // The collection's total value is built from these prices.
          void queryClient.invalidateQueries({ queryKey: ["collections"] });
        })
        .catch((err) => console.error("Failed to update foil status:", err));
    },
    [guid, patch, queryClient],
  );

  const markDownloaded = useCallback(
    (scanIds: string[]) => {
      if (!guid || scanIds.length === 0) return;
      const idSet = new Set(scanIds);
      patch((prev) =>
        prev.map((c) => (idSet.has(c.scanId) ? { ...c, isDownloaded: true } : c)),
      );
      markCollectionCardsDownloaded(guid, scanIds).catch((err) =>
        console.error("Failed to mark cards downloaded:", err),
      );
    },
    [guid, patch],
  );

  const emptyCollection = useCallback(async () => {
    if (!guid) return;
    try {
      // Awaited so a failure surfaces before the list visibly empties.
      await clearCollectionCards(guid);
    } catch (err) {
      // The scan screen used to reach this through a mutation whose onError
      // toasted; calling the fetch directly dropped that, and CardToolbar
      // catches into console.error — so a failed empty looked like a success.
      console.error("Failed to empty collection:", err);
      toast.error(t("errors.emptyFailed"));
      throw err;
    }
    queryClient.setQueryData<ScannedCard[]>(queryKey, []);
    void queryClient.invalidateQueries({ queryKey: ["collections"] });
  }, [guid, queryClient, t]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    cards,
    isLoading,
    removeCard,
    removeCards,
    correctCard,
    toggleFoil,
    markDownloaded,
    emptyCollection,
  };
}
