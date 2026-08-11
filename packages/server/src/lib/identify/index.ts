import type {
  IdentifyCandidate,
  IdentifyResult,
  OcrReading,
  PlayingCard,
} from "@magic-vault/shared";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import {
  normalizePokemonCard,
  type PokemonCardDetail,
} from "../pokemon/search";
import { normalizeScryfallCard } from "../scryfall/search";
import { getSetInfo } from "../set-index";
import { readCard } from "./ocr";
import {
  fetchFreshCard,
  persistRefreshedCard,
  withFreshPrice,
} from "./pricing";
import {
  getIdentityProfile,
  LEGACY_CUTOFF,
  LEGACY_LIMIT,
  type IdentityProfile,
} from "./profiles";
import { decideTier, rerank, type RerankInput } from "./rerank";

interface CandidateRow extends Record<string, unknown> {
  scryfall_id: string;
  distance: number;
  name: string;
  collector_number: string | null;
  set_total: number | null;
  set_code: string;
  card_data: unknown;
}

/**
 * Rebuilds the client-facing card from the stored upstream object.
 *
 * Reuses the same normalizers the search endpoints use, so `card.raw` keeps the
 * shape the bin rule engine resolves its paths against. Cards synced before the
 * card_data column existed simply have no stored object; they still rank, they
 * just arrive unhydrated.
 */
function hydrate(
  gameKey: string,
  data: unknown,
  fallback?: CandidateRow,
): PlayingCard | null {
  if (!data || typeof data !== "object") {
    // Degrade to what the indexed columns hold rather than returning null: the
    // client drops candidates it cannot render, so a missing detail would make
    // the right card vanish from the list entirely.
    return fallback ? minimalCard(fallback) : null;
  }
  try {
    if (gameKey === "pokemon") {
      return normalizePokemonCard(data as PokemonCardDetail);
    }
    if (gameKey === "mtg") {
      return normalizeScryfallCard(data as Parameters<typeof normalizeScryfallCard>[0]);
    }
  } catch {
    // A malformed stored object should not take the whole scan down.
    return fallback ? minimalCard(fallback) : null;
  }
  return fallback ? minimalCard(fallback) : null;
}

/** Enough of a card to display and to sort on, built from the columns alone. */
function minimalCard(row: CandidateRow): PlayingCard {
  return {
    id: row.scryfall_id,
    name: row.name,
    image: null,
    set: row.scryfall_id.split("-")[0] ?? "",
    setName: "",
    collectorNumber: row.collector_number ?? "",
    rarity: "",
    typeLine: "",
    colorIdentity: [],
    price: null,
  };
}

/** The candidate set's printed code, from the local set index. */
function abbreviationOf(gameKey: string, row: CandidateRow): string | null {
  if (gameKey !== "pokemon") return null;
  const setId =
    ((row.card_data as { set?: { id?: string } } | null)?.set?.id) ??
    row.set_code;
  return getSetInfo(setId)?.abbreviation ?? null;
}

function hpOf(gameKey: string, data: unknown): number | null {
  if (gameKey !== "pokemon" || !data || typeof data !== "object") return null;
  const hp = (data as { hp?: unknown }).hp;
  return typeof hp === "number" ? hp : null;
}

async function fetchCandidates(
  embedding: number[],
  gameKey: string,
  lang: string,
  limit: number,
  cutoff: number,
): Promise<CandidateRow[]> {
  const vector = `[${embedding.join(",")}]`;
  const result = await db.execute<CandidateRow>(sql`
    SELECT
      scryfall_id,
      name,
      collector_number,
      set_total,
      set_code,
      card_data,
      embedding <=> ${vector}::vector(768) AS distance
    FROM cards
    WHERE game_key = ${gameKey}
      AND lang = ${lang}
      AND (embedding <=> ${vector}::vector(768)) < ${cutoff}
    ORDER BY embedding <=> ${vector}::vector(768)
    LIMIT ${limit}
  `);
  return result.rows.map((r) => ({ ...r, distance: Number(r.distance) }));
}

/** Embedding-only path for games with no identity profile: unchanged behaviour. */
function withoutProfile(
  rows: CandidateRow[],
  gameKey: string,
): IdentifyResult {
  const candidates: IdentifyCandidate[] = rows.map((row) => ({
    id: row.scryfall_id,
    distance: row.distance,
    score: Math.max(0, 1 - row.distance / LEGACY_CUTOFF),
    card: hydrate(gameKey, row.card_data, row),
  }));
  return {
    tier: candidates.length > 0 ? "accept" : "no-match",
    margin:
      candidates.length > 1
        ? candidates[0].score - candidates[1].score
        : null,
    candidates,
  };
}

async function withProfile(
  rows: CandidateRow[],
  gameKey: string,
  profile: IdentityProfile,
  imageBuffer: Buffer,
): Promise<IdentifyResult> {
  // Start the price lookup for the nearest candidate now, so it overlaps with
  // OCR instead of adding to the scan. Re-ranking usually confirms this card;
  // when it does not, the winner is looked up afterwards (and that lookup is
  // cached, so a re-scan of the same card is free).
  const pricePromise = fetchFreshCard(gameKey, rows[0].scryfall_id);

  let ocr: OcrReading = {};
  if (profile.ocr) {
    try {
      ocr = await readCard(imageBuffer, profile.ocr);
    } catch (err) {
      // OCR is an enhancement; losing it degrades ranking, not correctness.
      console.error("[identify] OCR failed:", err);
    }
  }

  const inputs: RerankInput[] = rows.map((row) => ({
    id: row.scryfall_id,
    distance: row.distance,
    name: row.name,
    collectorNumber: row.collector_number,
    setTotal: row.set_total,
    hp: hpOf(gameKey, row.card_data),
    setAbbreviation: abbreviationOf(gameKey, row),
  }));

  const ranked = rerank(inputs, ocr, profile);
  const { tier, margin } = decideTier(ranked, profile);
  const byId = new Map(rows.map((r) => [r.scryfall_id, r]));

  const candidates: IdentifyCandidate[] = ranked.map((c) => ({
    ...c,
    card: hydrate(gameKey, byId.get(c.id)?.card_data, byId.get(c.id)),
  }));

  // Only the winner gets a fresh price — it is the only one whose price can
  // affect which bin the card is routed to.
  const winner = candidates[0];
  if (winner) {
    const fresh =
      winner.id === rows[0].scryfall_id
        ? await pricePromise
        : await fetchFreshCard(gameKey, winner.id);
    if (fresh) {
      winner.card = withFreshPrice(winner.card, fresh);
      persistRefreshedCard(winner.id, fresh);
    }
  } else {
    void pricePromise;
  }

  return { tier, margin, ocr, candidates };
}

export async function identifyCard(
  embedding: number[],
  imageBuffer: Buffer,
  gameKey: string,
  lang: string,
): Promise<IdentifyResult> {
  const profile = getIdentityProfile(gameKey);
  const rows = await fetchCandidates(
    embedding,
    gameKey,
    lang,
    profile?.candidateLimit ?? LEGACY_LIMIT,
    profile?.distanceCutoff ?? LEGACY_CUTOFF,
  );

  if (rows.length === 0) {
    return { tier: "no-match", margin: null, candidates: [] };
  }

  return profile
    ? withProfile(rows, gameKey, profile, imageBuffer)
    : withoutProfile(rows, gameKey);
}
