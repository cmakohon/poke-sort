import { rarityColor } from "@/features/cards/lib/rarity-color";
import { formatCardNumber } from "@/features/cards/lib/format-card-number";
import { CardPricingPanel } from "@/features/cards/components/card-pricing-panel";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BinLocationDiagram } from "@/features/bins/components/bin-location-diagram";
import { CardMetadataPanel } from "@/features/cards/components/card-metadata-panel";
import { CardSearchPicker } from "@/features/cards/components/card-search-picker";
import { cn } from "@/lib/utils";
import type {
  FieldMeta,
  PlayingCard,
  PlayingCardWithDistance,
} from "@poke-sort/shared";
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconExternalLink,
  IconPencil,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Fields the column above already renders verbatim, so the sorting table can
 * fold them away instead of repeating them.
 *
 * Keyed on field id, not label: labels are translated, and a game whose ids
 * differ simply matches nothing and shows everything — the safe direction to
 * fail. `category` and `stage` stay visible deliberately: the type line above
 * is a derived string, and the diagnostic table is where the raw values belong.
 */
const FIELDS_SHOWN_IN_DETAIL = [
  "name",
  "rarity",
  "hp",
  "set_name",
  "collector_number",
  "price_usd",
  "illustrator",
  "text",
] as const;

interface CardDetailPanelProps {
  scanId?: string;
  onClose: () => void;
  onRemove?: () => void;
  currentCard?: PlayingCardWithDistance;
  alternativeMatches?: PlayingCardWithDistance[];
  capturedImageUrl?: string;
  isFoil?: boolean;
  binNumber?: number;
  needsReview?: boolean;
  scanScore?: number;
  scanMargin?: number;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  currentIndex?: number;
  total?: number;
  /**
   * Mutations are passed in rather than pulled from the scanner context, so
   * this panel can edit a card in any collection. It used to call
   * useScannedCards() directly, which meant every write landed on whichever
   * collection happened to be active.
   */
  onCorrect?: (scanId: string, card: PlayingCard) => void;
  /** Manual add, when the panel is opened without a scanId. Scan screen only. */
  onAdd?: (card: PlayingCardWithDistance) => void;
  onToggleFoil?: (scanId: string, isFoil: boolean) => void;
  /**
   * Which collection's game and language the catalog search should use.
   * Without it the picker resolves the *active* collection, which is wrong
   * whenever you are looking at a different one.
   */
  searchCollectionGuid?: string;
  /**
   * The game's field definitions. Passed in rather than read from the active
   * game, so a collection of a different game shows its own field set.
   */
  fieldDefinitions?: FieldMeta[];
}

export function CardDetailPanel({
  scanId,
  onClose,
  onRemove,
  currentCard,
  alternativeMatches,
  capturedImageUrl,
  isFoil = false,
  binNumber,
  needsReview,
  scanScore,
  scanMargin,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  currentIndex,
  total,
  onCorrect,
  onAdd,
  onToggleFoil,
  searchCollectionGuid,
  fieldDefinitions,
}: CardDetailPanelProps) {
  const { t } = useTranslation("cards");
  const [editing, setEditing] = useState(false);
  const [candidates, setCandidates] = useState<PlayingCardWithDistance[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const prevScanIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!currentCard) return;
    if (scanId !== prevScanIdRef.current) {
      prevScanIdRef.current = scanId;
      const ids = new Set<string>();
      const all: PlayingCardWithDistance[] = [];
      for (const c of [currentCard, ...(alternativeMatches ?? [])]) {
        if (!ids.has(c.id)) {
          ids.add(c.id);
          all.push(c);
        }
      }
      setCandidates(all);
      setSelectedId(currentCard.id);
      setEditing(false);
    }
  }, [scanId, currentCard, alternativeMatches]);

  useEffect(() => {
    if (editing) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && hasPrev) onPrev?.();
      if (e.key === "ArrowRight" && hasNext) onNext?.();
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [editing, hasPrev, hasNext, onPrev, onNext, onClose]);

  const handleSelect = useCallback(
    (card: PlayingCard) => {
      if (scanId) onCorrect?.(scanId, card);
      else onAdd?.({ ...card, distance: 0 });
      onClose();
    },
    [scanId, onAdd, onCorrect, onClose],
  );

  const handleSelectCandidate = useCallback(
    (card: PlayingCardWithDistance) => {
      setSelectedId(card.id);
      if (scanId) onCorrect?.(scanId, card);
    },
    [scanId, onCorrect],
  );

  const selectedCard =
    candidates.find((c) => c.id === selectedId) ?? currentCard;
  const hasMultipleCandidates = candidates.length > 1;

  const cardName = selectedCard?.name ?? t("cardDetailPanel.cardDetailsFallback");
  const typeLine = selectedCard?.typeLine ?? "";

  return (
    <div className="flex h-full">
      <div className="sticky top-0 p-2 shrink-0 flex flex-col gap-2">
        <Button
          size="icon"
          variant="ghost"
          className="shrink-0 size-7"
          onClick={onClose}
          aria-label={t("cardDetailPanel.backToList")}
        >
          <IconX />
        </Button>
        <ButtonGroup orientation="vertical">
          <Button
            size="icon"
            variant="ghost"
            onClick={onPrev}
            disabled={!hasPrev}
            aria-label={t("cardDetailPanel.previousCard")}
          >
            <IconChevronUp />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onNext}
            disabled={!hasNext}
            aria-label={t("cardDetailPanel.nextCard")}
          >
            <IconChevronDown />
          </Button>
        </ButtonGroup>
      </div>
      <div className="flex-1 flex flex-col min-w-0 border-l">
        <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-2xl border-b p-2 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h2 className="font-semibold text-base truncate">{cardName}</h2>
              {total != null && currentIndex != null && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {currentIndex + 1} / {total}
                </span>
              )}
            </div>
            {typeLine && (
              <p className="text-sm text-muted-foreground truncate">
                {typeLine}
              </p>
            )}
          </div>
        </div>
        {/* Its own @container: the columns below should respond to the width
            of this panel, not of the route that happens to host it. */}
        <div className="p-6 flex flex-col gap-5 @container">
          {currentCard && !editing ? (
            <>
              {hasMultipleCandidates && (
                <div className="flex flex-col gap-3">
                  {capturedImageUrl ? (
                    <div className="flex items-center gap-4">
                      <div className="w-40 aspect-[2.5/3.5] rounded-lg overflow-hidden border shadow-sm shrink-0">
                        <img
                          src={capturedImageUrl}
                          alt={t("cardDetailPanel.scannedAlt")}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <p className="text-sm text-muted-foreground leading-snug">
                        {t("cardDetailPanel.selectCorrectVersion")}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground font-medium">
                      {t("cardDetailPanel.multipleMatches")}
                    </p>
                  )}
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {candidates.map((c) => {
                      const isSelected = c.id === selectedId;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleSelectCandidate(c)}
                          className="shrink-0 flex flex-col gap-1.5 items-center cursor-pointer group"
                        >
                          <div
                            className={cn(
                              "w-32 aspect-[2.5/3.5] rounded-lg overflow-hidden border-2 transition-all",
                              isSelected
                                ? "border-primary shadow-md"
                                : "border-border group-hover:border-primary/60",
                            )}
                          >
                            <img
                              src={c.image?.normal || c.image?.small || ""}
                              alt={c.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            {isSelected && (
                              <IconCheck className="size-3 text-primary shrink-0" />
                            )}
                            <p
                              className={cn(
                                "text-xs font-medium",
                                isSelected
                                  ? "text-primary"
                                  : "text-muted-foreground",
                              )}
                              title={`${c.setName || c.set} (${c.set.toUpperCase()})`}
                            >
                              {[c.setName || c.set.toUpperCase(), formatCardNumber(c)]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="border-t" />
                </div>
              )}
              {/* Wrapping flex rather than a grid: the image column is absent
                  whenever there are multiple candidates, and a fixed grid track
                  would leave a hole where it used to be. */}
              <div className="flex flex-col @2xl:flex-row @2xl:flex-wrap gap-6 items-start">
                {!hasMultipleCandidates && (
                  <div className="shrink-0 flex flex-col gap-3 items-center">
                    <div className="w-44 aspect-[2.5/3.5] rounded-lg overflow-hidden border shadow-sm">
                      <img
                        src={selectedCard?.image?.normal || ""}
                        alt={selectedCard?.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    {capturedImageUrl && (
                      <>
                        <p className="text-xs text-muted-foreground">
                          {t("cardDetailPanel.capturedScan")}
                        </p>
                        <div className="w-44 aspect-[2.5/3.5] rounded-lg overflow-hidden border">
                          <img
                            src={capturedImageUrl}
                            alt={t("cardDetailPanel.scannedAlt")}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

                {selectedCard && (
                  <div className="flex flex-col gap-3 min-w-0 flex-1 @2xl:basis-[22rem]">
                    {selectedCard.text && (
                      <p className="text-sm whitespace-pre-line leading-relaxed">
                        {selectedCard.text}
                      </p>
                    )}
                    {selectedCard.hp != null && (
                      <p className="text-sm font-semibold">
                        {selectedCard.hp} HP
                      </p>
                    )}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      <div
                        className="size-2 rounded-full shrink-0"
                        style={{
                          backgroundColor: rarityColor(selectedCard.rarity),
                        }}
                      />
                      <span className="capitalize">{selectedCard.rarity}</span>
                      <span>·</span>
                      <span>
                        {[selectedCard.setName, formatCardNumber(selectedCard)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    {binNumber != null && (
                      <div className="flex flex-col gap-1.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          {t("cardDetailPanel.binLocation")}
                        </p>
                        <div className="w-48 rounded-lg border">
                          <BinLocationDiagram
                            binNumber={binNumber}
                            inverted={false}
                          />
                        </div>
                      </div>
                    )}
                    {selectedCard.artist && (
                      <p className="text-xs text-muted-foreground">
                        {t("cardDetailPanel.artBy", { artist: selectedCard.artist })}
                      </p>
                    )}
                    {selectedCard.sourceUrl && (
                      <a
                        href={selectedCard.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline w-fit"
                      >
                        {t("cardDetailPanel.viewSource")}
                        <IconExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                )}
                {selectedCard && (
                  <CardPricingPanel
                    card={selectedCard}
                    className="w-full @5xl:w-80 @5xl:shrink-0 @5xl:basis-auto"
                  />
                )}
              </div>
              {/* Outside the row on purpose: the sorting table is wide, and
                  squeezing it into the details column wrapped every value. */}
              {selectedCard && (
                <CardMetadataPanel
                  card={selectedCard}
                  assignedBin={binNumber}
                  needsReview={needsReview}
                  scanScore={scanScore}
                  scanMargin={scanMargin}
                  fieldDefinitions={fieldDefinitions}
                  duplicateFields={FIELDS_SHOWN_IN_DETAIL}
                />
              )}
              <Label className="flex items-center gap-2 w-fit">
                <Switch
                  checked={isFoil}
                  onCheckedChange={(checked) => {
                    if (scanId) onToggleFoil?.(scanId, checked);
                  }}
                  disabled={!scanId || !onToggleFoil}
                />
                {t("cardDetailPanel.foil")}
              </Label>
              <div className="flex gap-3 pt-1">
                <Button
                  variant="outline"
                  onClick={() => setEditing(true)}
                >
                  <IconPencil className="size-4" />
                  {t("cardDetailPanel.correctCard")}
                </Button>
                <Button variant="destructive" onClick={() => onRemove?.()}>
                  <IconTrash className="size-4" />
                  {t("cardDetailPanel.remove")}
                </Button>
              </div>
            </>
          ) : (
            <>
              {capturedImageUrl && (
                <div className="flex items-center gap-4">
                  <div className="w-40 aspect-[2.5/3.5] rounded-lg overflow-hidden border shadow-sm shrink-0">
                    <img
                      src={capturedImageUrl}
                      alt={t("cardDetailPanel.scannedAlt")}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <p className="text-sm text-muted-foreground leading-snug">
                    {t("cardDetailPanel.searchForCorrectVersion")}
                  </p>
                </div>
              )}
              <CardSearchPicker
                onSelect={handleSelect}
                collectionGuid={searchCollectionGuid}
                initialQuery={selectedCard?.name ?? ""}
              />
              <Button variant="outline" onClick={() => setEditing(false)}>
                {t("cardDetailPanel.cancel")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
