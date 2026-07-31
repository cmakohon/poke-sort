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
import type { ScryfallCardWithDistance } from "@magic-vault/shared";
import {
  IconAlertTriangle,
  IconBug,
  IconCards,
  IconStack2,
} from "@tabler/icons-react";

// All three use real M11 image URLs so they actually render.
// set/collector differ to simulate a realistic multi-printing scenario.
const LIGHTNING_BOLT_M11: ScryfallCardWithDistance = {
  object: "card",
  id: "e3285e6b-3e79-4d7c-bf96-d920f973b122",
  oracle_id: "e3285e6b-0000-0000-0000-000000000000",
  name: "Lightning Bolt",
  lang: "en",
  released_at: "2010-07-16",
  uri: "",
  scryfall_uri: "https://scryfall.com/card/m11/149/lightning-bolt",
  layout: "normal",
  highres_image: true,
  image_status: "highres_scan",
  image_uris: {
    small:
      "https://cards.scryfall.io/small/front/e/3/e3285e6b-3e79-4d7c-bf96-d920f973b122.jpg",
    normal:
      "https://cards.scryfall.io/normal/front/e/3/e3285e6b-3e79-4d7c-bf96-d920f973b122.jpg",
    large:
      "https://cards.scryfall.io/large/front/e/3/e3285e6b-3e79-4d7c-bf96-d920f973b122.jpg",
    png: "https://cards.scryfall.io/png/front/e/3/e3285e6b-3e79-4d7c-bf96-d920f973b122.png",
    art_crop:
      "https://cards.scryfall.io/art_crop/front/e/3/e3285e6b-3e79-4d7c-bf96-d920f973b122.jpg",
    border_crop:
      "https://cards.scryfall.io/border_crop/front/e/3/e3285e6b-3e79-4d7c-bf96-d920f973b122.jpg",
  },
  mana_cost: "{R}",
  cmc: 1,
  type_line: "Instant",
  oracle_text: "Lightning Bolt deals 3 damage to any target.",
  colors: ["R"],
  color_identity: ["R"],
  set: "m11",
  set_name: "Magic 2011",
  collector_number: "149",
  rarity: "common",
  artist: "Christopher Moeller",
  border_color: "black",
  frame: "2015",
  reserved: false,
  foil: true,
  nonfoil: true,
  legalities: {} as never,
  prices: {
    usd: "1.20",
    usd_foil: null,
    usd_etched: null,
    eur: null,
    eur_foil: null,
    tix: null,
  },
  distance: 0.03,
  games: [],
  game_changer: false,
  finishes: [],
  oversized: false,
  promo: false,
  reprint: false,
  variation: false,
  set_id: "",
  set_type: "",
  set_uri: "",
  set_search_uri: "",
  scryfall_set_uri: "",
  rulings_uri: "",
  prints_search_uri: "",
  digital: false,
  artist_ids: [],
  full_art: false,
  textless: false,
  booster: false,
  story_spotlight: false,
  related_uris: undefined,
  purchase_uris: undefined,
};

const LIGHTNING_BOLT_A25: ScryfallCardWithDistance = {
  ...LIGHTNING_BOLT_M11,
  id: "debug-bolt-a25",
  released_at: "2018-03-16",
  scryfall_uri: "https://scryfall.com/card/a25/140/lightning-bolt",
  set: "a25",
  set_name: "Masters 25",
  collector_number: "140",
  artist: "Christopher Moeller",
  prices: {
    usd: "0.75",
    usd_foil: "3.50",
    usd_etched: null,
    eur: "0.60",
    eur_foil: null,
    tix: null,
  },
  distance: 0.05,
};

const LIGHTNING_BOLT_2X2: ScryfallCardWithDistance = {
  ...LIGHTNING_BOLT_M11,
  id: "debug-bolt-2x2",
  released_at: "2022-07-08",
  scryfall_uri: "https://scryfall.com/card/2x2/117/lightning-bolt",
  set: "2x2",
  set_name: "Double Masters 2022",
  collector_number: "117",
  artist: "Christopher Moeller",
  prices: {
    usd: "0.90",
    usd_foil: "5.00",
    usd_etched: null,
    eur: "0.80",
    eur_foil: null,
    tix: null,
  },
  distance: 0.06,
};

const MOCK_CARDS: ScryfallCardWithDistance[] = [LIGHTNING_BOLT_M11];

const FAKE_SCAN_URL =
  "https://cards.scryfall.io/art_crop/front/e/3/e3285e6b-3e79-4d7c-bf96-d920f973b122.jpg";

function proxiedImageUrl(url: string): string {
  return `/api/cards/image-proxy?url=${encodeURIComponent(url)}`;
}

const RISING_FREEDOM_GUNDAM_IMG = proxiedImageUrl(
  "https://www.gundam-gcg.com/en/images/cards/card/EB01-039.webp?260715",
);

const RISING_FREEDOM_GUNDAM: ScryfallCardWithDistance = {
  object: "card",
  id: "EB01-039",
  oracle_id: "EB01-039",
  name: "Rising Freedom Gundam",
  lang: "en",
  released_at: "",
  uri: "",
  scryfall_uri:
    "https://www.gundam-gcg.com/en/cards/detail.php?detailSearch=EB01-039",
  layout: "normal",
  highres_image: true,
  image_status: "highres_scan",
  image_uris: {
    small: RISING_FREEDOM_GUNDAM_IMG,
    normal: RISING_FREEDOM_GUNDAM_IMG,
    large: RISING_FREEDOM_GUNDAM_IMG,
    png: RISING_FREEDOM_GUNDAM_IMG,
    art_crop: RISING_FREEDOM_GUNDAM_IMG,
    border_crop: RISING_FREEDOM_GUNDAM_IMG,
  },
  cmc: 5,
  type_line: "UNIT",
  oracle_text:
    "When playing this card from your hand, if 3 or more enemy Units are in play, play it as if it has 3 Lv. and cost.",
  power: "4",
  toughness: "4",
  colors: ["Green"],
  color_identity: ["Green"],
  keywords: [],
  set: "EB01",
  set_name: "Eternal Nexus",
  collector_number: "039",
  rarity: "c",
  artist: "",
  border_color: "black",
  frame: "2015",
  reserved: false,
  foil: false,
  nonfoil: true,
  legalities: {} as never,
  prices: {
    usd: null,
    usd_foil: null,
    usd_etched: null,
    eur: null,
    eur_foil: null,
    tix: null,
  },
  distance: 0.03,
  games: [],
  game_changer: false,
  finishes: [],
  oversized: false,
  promo: false,
  reprint: false,
  variation: false,
  set_id: "",
  set_type: "",
  set_uri: "",
  set_search_uri: "",
  scryfall_set_uri: "",
  rulings_uri: "",
  prints_search_uri: "",
  digital: false,
  artist_ids: [],
  full_art: false,
  textless: false,
  booster: false,
  story_spotlight: false,
  related_uris: undefined,
  purchase_uris: undefined,
};

const STRIKE_FREEDOM_GUNDAM_IMG = proxiedImageUrl(
  "https://www.gundam-gcg.com/en/images/cards/card/EB01-041.webp?260715",
);

const STRIKE_FREEDOM_GUNDAM: ScryfallCardWithDistance = {
  ...RISING_FREEDOM_GUNDAM,
  id: "EB01-041",
  oracle_id: "EB01-041",
  name: "Strike Freedom Gundam (EX)",
  scryfall_uri:
    "https://www.gundam-gcg.com/en/cards/detail.php?detailSearch=EB01-041",
  image_uris: {
    small: STRIKE_FREEDOM_GUNDAM_IMG,
    normal: STRIKE_FREEDOM_GUNDAM_IMG,
    large: STRIKE_FREEDOM_GUNDAM_IMG,
    png: STRIKE_FREEDOM_GUNDAM_IMG,
    art_crop: STRIKE_FREEDOM_GUNDAM_IMG,
    border_crop: STRIKE_FREEDOM_GUNDAM_IMG,
  },
  cmc: 6,
  type_line: "UNIT",
  oracle_text:
    "<High-Maneuver> (This Unit can't be blocked.)\n【Deploy】Choose 1 Unit with 4 or less HP belonging to each enemy player. Return them to their owners' hands.",
  power: "5",
  toughness: "5",
  colors: ["White"],
  color_identity: ["White"],
  keywords: ["High-Maneuver"],
  set: "EB01",
  set_name: "Eternal Nexus",
  collector_number: "041",
  rarity: "lr",
  distance: 0.03,
};

const STRIKE_FREEDOM_GUNDAM_P1: ScryfallCardWithDistance = {
  ...STRIKE_FREEDOM_GUNDAM,
  id: "EB01-041_p1",
  oracle_id: "EB01-041_p1",
  rarity: "sr",
  distance: 0.05,
};

const STRIKE_FREEDOM_GUNDAM_P2: ScryfallCardWithDistance = {
  ...STRIKE_FREEDOM_GUNDAM,
  id: "EB01-041_p2",
  oracle_id: "EB01-041_p2",
  rarity: "sec",
  distance: 0.06,
};

const GUNDAM_MOCK_CARDS: ScryfallCardWithDistance[] = [RISING_FREEDOM_GUNDAM];

let mockCardIndex = 0;

export function ScannerDebug() {
  const { isAdmin } = useRole();
  const { addCard } = useScannedCards();
  const { activeCollection } = useCollections();

  if (!isAdmin) return null;

  const isGundam = activeCollection?.game?.key === "gundam";

  const handleSimulateScan = () => {
    const cards = isGundam ? GUNDAM_MOCK_CARDS : MOCK_CARDS;
    const card = cards[mockCardIndex % cards.length];
    mockCardIndex++;
    addCard(card);
  };

  const handleSimulateMultiMatch = () => {
    if (isGundam) {
      addCard(STRIKE_FREEDOM_GUNDAM, STRIKE_FREEDOM_GUNDAM_IMG, [
        STRIKE_FREEDOM_GUNDAM_P1,
        STRIKE_FREEDOM_GUNDAM_P2,
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
            Debug
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={handleSimulateScan}>
            <IconCards className="size-3.5" />
            Simulate Scan
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleSimulateMultiMatch}>
            <IconStack2 className="size-3.5" />
            Simulate Multi-Match
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
            Force Error
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
