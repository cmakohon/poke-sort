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
import { ZoomableCardImage } from "@/features/cards/components/zoomable-card-image";
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
  /**
   * Whether to offer the other candidates the scan matched. True while a card
   * is being sorted or reviewed; false once it is filed, where the match is
   * settled and the strip only crowds out the card itself.
   */
  showCandidates?: boolean;
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
  showCandidates = true,
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
      // These are document-level, so an open dialog would otherwise get its
      // Escape twice: once closing the enlarged image, once closing the panel
      // behind it. Arrows are just as wrong there — they would page to another
      // card while its image is still on screen.
      if (document.querySelector('[data-slot="dialog-content"][data-open]')) {
        return;
      }
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
  /**
   * The candidate picker earns its space while a card is still being sorted or
   * reviewed, where "is this the right match?" is the open question. Once the
   * card is in a collection that question is settled, and a row of rejected
   * alternatives is just a large thing between you and the card. Correcting a
   * filed card is still one button away — it opens a catalog search seeded
   * with the card's name, which finds the same alternatives.
   */
  const showCandidateStrip = showCandidates && candidates.length > 1;

  const cardName = selectedCard?.name ?? t("cardDetailPanel.cardDetailsFallback");
  const typeLine = selectedCard?.typeLine ?? "";
  const cardNumber = selectedCard ? formatCardNumber(selectedCard) : "";

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
        <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-2xl border-b px-4 py-3 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h2 className="font-semibold font-heading text-2xl truncate">
                {cardName}
              </h2>
              {total != null && currentIndex != null && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {currentIndex + 1} / {total}
                </span>
              )}
            </div>
            {/* The set is what identifies a printing, so it belongs in the
                header rather than buried in a meta line halfway down. */}
            <p className="text-sm text-muted-foreground truncate">
              {[selectedCard?.setName, cardNumber, typeLine]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
        {/* Its own @container: the columns below should respond to the width
            of this panel, not of the route that happens to host it. */}
        <div className="p-6 flex flex-col gap-5 @container">
          {currentCard && !editing ? (
            <>
              {showCandidateStrip && (
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
                {!showCandidateStrip && (
                  <div className="shrink-0 flex flex-col gap-3 items-center">
                    <ZoomableCardImage
                      src={selectedCard?.image?.normal || ""}
                      alt={selectedCard?.name ?? cardName}
                      className="w-44 aspect-[2.5/3.5] shadow-sm"
                    />
                    {capturedImageUrl && (
                      <>
                        <p className="text-xs text-muted-foreground">
                          {t("cardDetailPanel.capturedScan")}
                        </p>
                        <ZoomableCardImage
                          src={capturedImageUrl}
                          alt={t("cardDetailPanel.scannedAlt")}
                          className="w-44 aspect-[2.5/3.5]"
                        />
                      </>
                    )}
                  </div>
                )}

                {selectedCard && (
                  // Its own @container so the sorting table below measures this
                  // column rather than the whole panel, and picks a column count
                  // that actually fits.
                  <div className="flex flex-col gap-3 min-w-0 flex-1 @2xl:basis-[22rem] @container">
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
                    {/* Set and number moved to the header; only the rarity is
                        left, and it needs its colour swatch to mean anything. */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      <div
                        className="size-2 rounded-full shrink-0"
                        style={{
                          backgroundColor: rarityColor(selectedCard.rarity),
                        }}
                      />
                      <span className="capitalize">{selectedCard.rarity}</span>
                    </div>
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
                    {/* Stacked under the card's own facts rather than banished
                        below the row: the card info alone left this column a
                        third as tall as the two beside it. */}
                    <CardMetadataPanel
                      card={selectedCard}
                      assignedBin={binNumber}
                      needsReview={needsReview}
                      scanScore={scanScore}
                      scanMargin={scanMargin}
                      fieldDefinitions={fieldDefinitions}
                      duplicateFields={FIELDS_SHOWN_IN_DETAIL}
                    />
                  </div>
                )}
                {selectedCard && (
                  // Actions ride above pricing rather than at the foot of the
                  // page: they were three screens down past the sorting table,
                  // and the reverse-holo switch in particular belongs next to
                  // the number it changes.
                  <div className="w-full @5xl:w-80 @5xl:shrink-0 @5xl:basis-auto flex flex-col gap-3">
                    <div className="flex flex-col gap-3 rounded-lg border p-4">
                      <Label className="flex items-center gap-2 w-fit">
                        <Switch
                          checked={isFoil}
                          onCheckedChange={(checked) => {
                            if (scanId) onToggleFoil?.(scanId, checked);
                          }}
                          disabled={!scanId || !onToggleFoil}
                        />
                        {t("cardDetailPanel.reverseHolo")}
                      </Label>
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditing(true)}
                        >
                          <IconPencil className="size-4" />
                          {t("cardDetailPanel.correctCard")}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => onRemove?.()}
                        >
                          <IconTrash className="size-4" />
                          {t("cardDetailPanel.remove")}
                        </Button>
                      </div>
                    </div>
                    <CardPricingPanel
                      card={selectedCard}
                      // Follows the switch immediately, before the server's
                      // repriced card comes back.
                      variant={isFoil ? "reverse" : undefined}
                    />
                  </div>
                )}
              </div>
              {/* Last: where the card physically went is a fact about one past
                  sorting run, not about the card, so it should not sit above
                  the card's own data. */}
              {binNumber != null && (
                <div className="flex flex-col gap-1.5 pt-2 border-t">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    {t("cardDetailPanel.binLocation")}
                  </p>
                  <div className="w-48 rounded-lg border">
                    <BinLocationDiagram binNumber={binNumber} inverted={false} />
                  </div>
                </div>
              )}
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
