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
import type { PlayingCardWithDistance } from "@magic-vault/shared";
import {
  IconAlertTriangle,
  IconBug,
  IconCards,
  IconStack2,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

// All three use real M11 image URLs so they actually render.
// set/collector differ to simulate a realistic multi-printing scenario.
const LIGHTNING_BOLT_M11: PlayingCardWithDistance = {
  id: "e3285e6b-3e79-4d7c-bf96-d920f973b122",
  name: "Lightning Bolt",
  image: {
    small:
      "https://cards.scryfall.io/small/front/e/3/e3285e6b-3e79-4d7c-bf96-d920f973b122.jpg",
    normal:
      "https://cards.scryfall.io/normal/front/e/3/e3285e6b-3e79-4d7c-bf96-d920f973b122.jpg",
  },
  manaCost: "{R}",
  cmc: 1,
  typeLine: "Instant",
  text: "Lightning Bolt deals 3 damage to any target.",
  colorIdentity: ["R"],
  set: "m11",
  setName: "Magic 2011",
  collectorNumber: "149",
  rarity: "common",
  artist: "Christopher Moeller",
  price: 1.2,
  sourceUrl: "https://scryfall.com/card/m11/149/lightning-bolt",
  distance: 0.03,
};

const LIGHTNING_BOLT_A25: PlayingCardWithDistance = {
  ...LIGHTNING_BOLT_M11,
  id: "debug-bolt-a25",
  sourceUrl: "https://scryfall.com/card/a25/140/lightning-bolt",
  set: "a25",
  setName: "Masters 25",
  collectorNumber: "140",
  price: 0.75,
  distance: 0.05,
};

const LIGHTNING_BOLT_2X2: PlayingCardWithDistance = {
  ...LIGHTNING_BOLT_M11,
  id: "debug-bolt-2x2",
  sourceUrl: "https://scryfall.com/card/2x2/117/lightning-bolt",
  set: "2x2",
  setName: "Double Masters 2022",
  collectorNumber: "117",
  price: 0.9,
  distance: 0.06,
};

const MOCK_CARDS: PlayingCardWithDistance[] = [LIGHTNING_BOLT_M11];

const FAKE_SCAN_URL =
  "https://cards.scryfall.io/art_crop/front/e/3/e3285e6b-3e79-4d7c-bf96-d920f973b122.jpg";

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
  cmc: 1,
  typeLine: "Pokemon - Basic",
  text: "When several of these Pokémon gather, their electricity can cause lightning storms.\n\nGnaw (10)\nThunder Jolt (30) Flip a coin. If tails, Pikachu does 10 damage to itself.",
  power: undefined,
  toughness: "40",
  colorIdentity: ["Lightning"],
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

  const isPokemon = activeCollection?.game?.key === "pokemon";

  const handleSimulateScan = () => {
    const cards = isPokemon ? POKEMON_MOCK_CARDS : MOCK_CARDS;
    const card = cards[mockCardIndex % cards.length];
    mockCardIndex++;
    addCard(card);
  };

  const handleSimulateMultiMatch = () => {
    if (isPokemon) {
      addCard(PIKACHU_BASE1, PIKACHU_IMG, [
        PIKACHU_BASE1_SHADOWLESS,
        PIKACHU_BASE1_1ST_EDITION,
      ]);
      return;
    }
    addCard(LIGHTNING_BOLT_M11, FAKE_SCAN_URL, [
      LIGHTNING_BOLT_A25,
      LIGHTNING_BOLT_2X2,
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
