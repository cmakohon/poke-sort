import type { CorrectionProvenance } from "@/features/collections/api/collections";
import {
  evaluateCardBin,
  type BinConfig,
  type FieldMeta,
  type PlayingCard,
  type PlayingCardWithDistance,
  type ScannedCard,
} from "@poke-sort/shared";

export interface BuiltCorrection {
  corrected: PlayingCardWithDistance;
  binNumber?: number;
  provenance: CorrectionProvenance;
}

/**
 * Works out what a human correction changes about a card.
 *
 * The provenance half is the part that matters: `original_*` must hold what
 * the *pipeline* predicted, never a human's earlier answer, so it is written
 * once on the first correction and left alone afterwards. Correcting a card
 * used to simply overwrite the row and reset distance to 0, which destroyed
 * the evidence that the model had been wrong — and a wrong identification is
 * the cheapest labelled eval data there is.
 *
 * Shared so the scan screen and the collection detail screen cannot drift on
 * that rule.
 */
export function buildCorrection(
  previous: ScannedCard | undefined,
  card: PlayingCard,
  binConfigs: BinConfig[],
  fieldDefinitions: FieldMeta[],
): BuiltCorrection {
  const corrected: PlayingCardWithDistance = { ...card, distance: 0 };
  const matchedBin = evaluateCardBin(corrected, binConfigs, fieldDefinitions);

  const provenance: CorrectionProvenance = previous?.wasCorrected
    ? {} // already recorded; don't overwrite with the last correction
    : {
        originalCardId: previous?.card.id,
        originalDistance: previous?.card.distance,
        originalScore: previous?.score,
        wasCorrected: true,
      };

  return { corrected, binNumber: matchedBin?.binNumber, provenance };
}
