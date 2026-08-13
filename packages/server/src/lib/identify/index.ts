import type {
  IdentifyCandidate,
  IdentifyResult,
  OcrReading,
  PlayingCard,
} from "@poke-sort/shared";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { db } from "../../db";
import {
  normalizePokemonCard,
  type PokemonCardDetail,
} from "../pokemon/search";
import { getSetInfo } from "../set-index";
import { vectorizeImageFromBuffer } from "../vectorize";
import { readCard } from "./ocr";
import { detectFirstEditionStamp, hasFirstEditionVariant } from "./stamp";
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
  card_id: string;
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
  } catch {
    // A malformed stored object should not take the whole scan down.
    return fallback ? minimalCard(fallback) : null;
  }
  return fallback ? minimalCard(fallback) : null;
}

/** Enough of a card to display and to sort on, built from the columns alone. */
function minimalCard(row: CandidateRow): PlayingCard {
  return {
    id: row.card_id,
    name: row.name,
    image: null,
    set: row.card_id.split("-")[0] ?? "",
    setName: "",
    collectorNumber: row.collector_number ?? "",
    rarity: "",
    typeLine: "",
    types: [],
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

/** Exported for the eval harness, which captures the intermediate stages. */
export async function fetchCandidates(
  embedding: number[],
  gameKey: string,
  lang: string,
  limit: number,
  cutoff: number,
  excludedSetIds: string[] = [],
): Promise<CandidateRow[]> {
  const vector = `[${embedding.join(",")}]`;
  // Digital-only sets are excluded here, at candidate time, rather than from
  // the catalog: search and pricing still want them, but a physical capture
  // can never be one, and their art-identical twins eat ranking margin.
  const exclusion =
    excludedSetIds.length > 0
      ? sql`AND set_code NOT IN (${sql.join(
          excludedSetIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;
  const result = await db.execute<CandidateRow>(sql`
    SELECT
      card_id,
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
      ${exclusion}
    ORDER BY embedding <=> ${vector}::vector(768)
    LIMIT ${limit}
  `);
  return result.rows.map((r) => ({ ...r, distance: Number(r.distance) }));
}

/**
 * The rerank view of a candidate row. Shared between the live pipeline and the
 * eval capture script, so the two can never drift apart on what a candidate
 * looks like to the fusion.
 */
export function buildRerankInputs(
  rows: CandidateRow[],
  gameKey: string,
): RerankInput[] {
  return rows.map((row) => ({
    id: row.card_id,
    distance: row.distance,
    name: row.name,
    collectorNumber: row.collector_number,
    setTotal: row.set_total,
    hp: hpOf(gameKey, row.card_data),
    setAbbreviation: abbreviationOf(gameKey, row),
  }));
}

/** Embedding-only path for games with no identity profile: unchanged behaviour. */
function withoutProfile(
  rows: CandidateRow[],
  gameKey: string,
): IdentifyResult {
  const candidates: IdentifyCandidate[] = rows.map((row) => ({
    id: row.card_id,
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
  ocrPromise: Promise<OcrReading>,
): Promise<IdentifyResult> {
  // A pass whose nearest match is beyond the retry threshold is probably about
  // to be discarded for the flipped orientation — so the winner-side side
  // effects (price fetch, catalog write-back, stamp detection) are skipped:
  // they would fire for a card the user did not scan, burn a TCGdex request
  // the retry is about to need, and read a stamp ROI off inverted pixels. The
  // ranking itself still runs in full, because the retry decision compares the
  // two passes' results.
  const discardable = rows[0].distance > RETRY_DISTANCE;

  // Start the price lookup for the nearest candidate now, so it overlaps with
  // OCR instead of adding to the scan. Re-ranking usually confirms this card;
  // when it does not, the winner is looked up afterwards (and that lookup is
  // cached, so a re-scan of the same card is free).
  const pricePromise = discardable
    ? Promise.resolve(null)
    : fetchFreshCard(gameKey, rows[0].card_id);

  const ocr = await ocrPromise;

  const inputs = buildRerankInputs(rows, gameKey);

  const ranked = rerank(inputs, ocr, profile);
  const { tier, margin } = decideTier(ranked, profile);
  const byId = new Map(rows.map((r) => [r.card_id, r]));

  const candidates: IdentifyCandidate[] = ranked.map((c) => ({
    ...c,
    card: hydrate(gameKey, byId.get(c.id)?.card_data, byId.get(c.id)),
  }));

  // Only the winner gets a fresh price — it is the only one whose price can
  // affect which bin the card is routed to.
  const winner = candidates[0];
  let stamp: Awaited<ReturnType<typeof detectFirstEditionStamp>> | undefined;
  if (winner && !discardable) {
    const winnerRow = byId.get(winner.id);

    // 1st Edition detection, gated on the card actually having that printing —
    // which confines it to the classic-frame sets the detector understands.
    if (gameKey === "pokemon" && hasFirstEditionVariant(winnerRow?.card_data)) {
      try {
        stamp = await detectFirstEditionStamp(imageBuffer);
        const variant = stamp.stamped ? "firstEdition" : "normal";
        if (winner.card) {
          // Rebuilt with the variant so the price follows the detected
          // printing — a stamped Base Set card is not priced like unlimited.
          winner.card = normalizePokemonCard(
            winnerRow?.card_data as PokemonCardDetail,
            stamp.stamped ? "firstEdition" : undefined,
          );
          winner.card.variant = variant;
          // Onto the raw object too: bin rules resolve paths against `raw`,
          // and the stored scan keeps it for later re-evaluation.
          (winner.card.raw as Record<string, unknown>).variant = variant;
        }
      } catch (err) {
        // Detection is an enhancement; a failure must not break the scan.
        console.error("[identify] stamp detection failed:", err);
      }
    }

    // A detected 1st Edition keeps its pack-time variant price: the live
    // lookup is variant-blind and would overwrite it with unlimited pricing.
    if (stamp?.stamped) {
      void pricePromise;
    } else {
      const fresh =
        winner.id === rows[0].card_id
          ? await pricePromise
          : await fetchFreshCard(gameKey, winner.id);
      if (fresh) {
        winner.card = withFreshPrice(winner.card, fresh);
        persistRefreshedCard(winner.id, fresh);
      }
    }
  } else {
    void pricePromise;
  }

  return { tier, margin, ocr, candidates, stamp };
}

/**
 * When a pass is weak enough that trying the other orientation is worth a
 * second embedding. Good matches on the fixture set never exceed 0.132
 * nearest distance (cutoff 0.3), so 0.2 is far from anything real. ⚠ This is
 * a render-domain number: if real camera captures legitimately land above 0.2,
 * every hard-but-right card pays for a useless retry — revisit with real
 * fixtures.
 */
const RETRY_DISTANCE = 0.2;

function nearestDistance(result: IdentifyResult): number {
  return result.candidates.length > 0
    ? Math.min(...result.candidates.map((c) => c.distance))
    : Infinity;
}

/**
 * Orientation of the previous winning scan, process-wide on purpose: there is
 * one physical feeder, and cards come off a stack that was loaded one way.
 * When the last card identified upside down, the next one almost certainly
 * will too — so the remembered orientation is tried first, turning a flipped
 * stack from every-card-pays-the-retry (an extra full pass, ~700ms+) into
 * first-card-pays-it (the rest pay only a ~50ms rotate).
 */
let preferFlipped = false;

/** Lossless 180° flip: a bare toBuffer() would re-encode the JPEG at quality
 *  80, degrading exactly the marginal capture the retry exists to rescue. */
function flip180(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer).rotate(180).png().toBuffer();
}

/**
 * The full pipeline with orientation recovery.
 *
 * A card fed upside down embeds to garbage — SigLIP is not rotation
 * invariant, and the OCR bands read the wrong corners — so it used to sail
 * straight to no-match and the catch-all bin. When the first pass comes back
 * with nothing (or nothing closer than any real match ever measures), the
 * capture is flipped 180° and identified again, and the better pass wins.
 * The winning orientation is remembered for the next scan (see preferFlipped).
 *
 * `flippedRetry` on the result means the winner ran on the 180°-rotated
 * capture — i.e. the card was fed upside down relative to the camera —
 * whether or not a retry pass was actually paid for it.
 */
export async function identifyCard(
  imageBuffer: Buffer,
  gameKey: string,
  lang: string,
): Promise<IdentifyResult> {
  const firstFlipped = preferFlipped;
  const firstBuffer = firstFlipped ? await flip180(imageBuffer) : imageBuffer;
  const first = await identifyOnce(firstBuffer, gameKey, lang);
  if (nearestDistance(first) <= RETRY_DISTANCE) {
    first.flippedRetry = firstFlipped;
    return first;
  }

  const secondBuffer = firstFlipped ? imageBuffer : await flip180(imageBuffer);
  const second = await identifyOnce(secondBuffer, gameKey, lang);
  // Strictly better or bust: on a genuinely unreadable capture both passes
  // fail, and the first result's diagnostics are the truthful ones.
  if (nearestDistance(second) < nearestDistance(first)) {
    preferFlipped = !firstFlipped;
    second.flippedRetry = !firstFlipped;
    return second;
  }
  first.flippedRetry = firstFlipped;
  return first;
}

/**
 * One oriented pass, owning its own concurrency.
 *
 * OCR does not depend on the embedding, so it starts the moment the image
 * arrives and runs beside the SigLIP forward pass and the candidate query —
 * the two big fixed costs overlap instead of stacking. Sequentially this was
 * p95 2.2s against a 2s budget; the overlap alone removes the embedding+query
 * ~500ms from every card's critical path.
 */
async function identifyOnce(
  imageBuffer: Buffer,
  gameKey: string,
  lang: string,
): Promise<IdentifyResult> {
  const profile = getIdentityProfile(gameKey);

  const ocrPromise: Promise<OcrReading> = profile?.ocr
    ? readCard(imageBuffer, profile.ocr).catch((err) => {
        // OCR is an enhancement; losing it degrades ranking, not correctness.
        console.error("[identify] OCR failed:", err);
        return {};
      })
    : Promise.resolve({});

  const embedding = await vectorizeImageFromBuffer(imageBuffer);
  const rows = await fetchCandidates(
    embedding,
    gameKey,
    lang,
    profile?.candidateLimit ?? LEGACY_LIMIT,
    profile?.distanceCutoff ?? LEGACY_CUTOFF,
    profile?.excludedSetIds ?? [],
  );

  if (rows.length === 0) {
    // The pool would otherwise sit on an unread result.
    void ocrPromise;
    return { tier: "no-match", margin: null, candidates: [] };
  }

  return profile
    ? withProfile(rows, gameKey, profile, imageBuffer, ocrPromise)
    : withoutProfile(rows, gameKey);
}
