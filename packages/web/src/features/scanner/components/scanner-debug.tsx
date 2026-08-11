import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCollections } from "@/features/collections/api/use-collections";
import { useScannedCards } from "@/features/scanner/api/use-scanned-cards";
import { useRole } from "@/hooks/use-role";
import { apiPost } from "@/lib/api/client";
import type { PlayingCardWithDistance } from "@poke-sort/shared";
import {
  IconAlertTriangle,
  IconBug,
  IconCards,
  IconStack2,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

function proxiedImageUrl(url: string): string {
  return `/api/cards/image-proxy?url=${encodeURIComponent(url)}`;
}

const PIKACHU_IMG = proxiedImageUrl(
  "https://assets.tcgdex.net/en/base/base1/58/high.webp",
);

const PIKACHU_BASE1: PlayingCardWithDistance = {
  id: "base1-58",
  name: "Pikachu",
  image: { small: PIKACHU_IMG, normal: PIKACHU_IMG },
  retreatCost: 1,
  typeLine: "Pokemon - Basic",
  text: "When several of these Pokémon gather, their electricity can cause lightning storms.\n\nGnaw (10)\nThunder Jolt (30) Flip a coin. If tails, Pikachu does 10 damage to itself.",
  hp: "40",
  types: ["Lightning"],
  set: "base1",
  setName: "Base Set",
  collectorNumber: "58",
  rarity: "common",
  artist: "Mitsuhiro Arita",
  price: null,
  sourceUrl: "https://tcgdex.dev/cards/base1-58",
  distance: 0.03,
};

const PIKACHU_BASE1_SHADOWLESS: PlayingCardWithDistance = {
  ...PIKACHU_BASE1,
  id: "base1-58_shadowless",
  distance: 0.04,
};

const PIKACHU_BASE1_1ST_EDITION: PlayingCardWithDistance = {
  ...PIKACHU_BASE1,
  id: "base1-58_1st",
  distance: 0.06,
};

const POKEMON_MOCK_CARDS: PlayingCardWithDistance[] = [PIKACHU_BASE1];

let mockCardIndex = 0;

export function ScannerDebug() {
  const { t } = useTranslation("scanner");
  const { isAdmin } = useRole();
  const { addCard } = useScannedCards();
  const { activeCollection } = useCollections();

  if (!isAdmin) return null;

  const handleSimulateScan = () => {
    const card = POKEMON_MOCK_CARDS[mockCardIndex % POKEMON_MOCK_CARDS.length];
    mockCardIndex++;
    addCard(card);
  };

  const handleSimulateMultiMatch = () => {
    addCard(PIKACHU_BASE1, PIKACHU_IMG, [
      PIKACHU_BASE1_SHADOWLESS,
      PIKACHU_BASE1_1ST_EDITION,
    ]);
  };

  const handleForceError = () => {
    if (!activeCollection) return;
    apiPost(`/api/collections/${activeCollection.guid}/debug/error`, {}).catch(
      () => {},
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="icon" variant="outline">
            <IconBug className="size-3.5" />
          </Button>
        }
      ></DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-mono">
            {t("scannerDebug.heading")}
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={handleSimulateScan}>
            <IconCards className="size-3.5" />
            {t("scannerDebug.simulateScan")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleSimulateMultiMatch}>
            <IconStack2 className="size-3.5" />
            {t("scannerDebug.simulateMultiMatch")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={handleForceError}
            disabled={!activeCollection}
            variant="destructive"
          >
            <IconAlertTriangle className="size-3.5" />
            {t("scannerDebug.forceError")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
