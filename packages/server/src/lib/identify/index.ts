import type {
  IdentifyCandidate,
  IdentifyResult,
  OcrReading,
  PlayingCard,
} from "@poke-sort/shared";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { db } from "../../db";
import { hydrateCatalogCard, type CatalogCardRow } from "../catalog-card";
// Directly, not through hydrateCatalogCard: the winner is rebuilt with a
// detected variant, which that helper deliberately knows nothing about.
import {
  normalizePokemonCard,
  type PokemonCardDetail,
} from "../pokemon/search";
import { artWindowKey, cropArt, distinctArtWindows } from "../art-window";
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
import {
  artWindowForRow,
  buildRerankInputs,
  setIdOf,
  type CandidateRow,
} from "./candidates";

// Re-exported so the eval harness and tests keep one import site for the
// candidate view, without this module's database import coming with it.
export { buildRerankInputs, setIdOf, type CandidateRow };

/** A row's card, or null when the id is not among the rows at all. */
function hydrate(gameKey: string, row: CandidateRow | undefined) {
  return row ? hydrateCatalogCard(gameKey, row) : null;
}

/**
 * Exported for the eval harness, which captures the intermediate stages.
 *
 * `artVectors` maps a window key to the capture embedded under that window
 * (see lib/art-window.ts). The capture's era is not knowable at scan time, so
 * it is embedded once per DISTINCT window and each candidate is compared under
 * its own series' geometry. Omit it to get the pre-art behaviour exactly.
 */
export async function fetchCandidates(
  embedding: number[],
  gameKey: string,
  lang: string,
  limit: number,
  cutoff: number,
  excludedSetIds: string[] = [],
  artVectors: Map<string, number[]> = new Map(),
): Promise<CandidateRow[]> {
  const vector = `[${embedding.join(",")}]`;
  // One output column per window. These sit in the TARGET LIST only, never in
  // WHERE or ORDER BY: retrieval stays whole-card, so Postgres evaluates them
  // on the ~50 rows that survive the LIMIT rather than the whole catalog.
  const windowKeys = [...artVectors.keys()];
  const artSelects = windowKeys.map(
    (key, i) =>
      sql`, embedding_art <=> ${`[${artVectors.get(key)!.join(",")}]`}::vector(768) AS ${sql.raw(`art_d${i}`)}`,
  );
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
      ${sql.join(artSelects, sql``)}
    FROM cards
    WHERE game_key = ${gameKey}
      AND lang = ${lang}
      AND (embedding <=> ${vector}::vector(768)) < ${cutoff}
      ${exclusion}
    ORDER BY embedding <=> ${vector}::vector(768)
    LIMIT ${limit}
  `);
  return result.rows.map((row) => {
    const window = artWindowForRow(row);
    const i = window ? windowKeys.indexOf(artWindowKey(window)) : -1;
    // Number(null) is 0, and 0 is a PERFECT match — a card the catalog has no
    // art vector for would beat every card that does. `embedding` is NOT NULL
    // so `distance` never hits this; `embedding_art` is nullable, so this one
    // must stay explicit.
    const raw = i >= 0 ? (row as Record<string, unknown>)[`art_d${i}`] : null;
    return {
      ...row,
      distance: Number(row.distance),
      art_distance: raw == null ? null : Number(raw),
    };
  });
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
    card: hydrate(gameKey, row),
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
    card: hydrate(gameKey, byId.get(c.id)),
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

const NO_ART: Map<string, number[]> = new Map();

/**
 * The capture embedded under every distinct art window.
 *
 * Which window applies depends on the card's series, which is exactly what the
 * scan is trying to work out — so the capture is cropped every way the table
 * asks for and each candidate is compared under its own. One window today, so
 * one extra forward pass; the cost is linear in DISTINCT windows, not series.
 *
 * A failure here degrades ranking, not correctness: no art vector means every
 * candidate is scored on its whole-card distance, which is what the pipeline
 * did before.
 */
async function embedArtViews(imageBuffer: Buffer): Promise<Map<string, number[]>> {
  const windows = distinctArtWindows();
  if (windows.length === 0) return NO_ART;
  const out = new Map<string, number[]>();
  for (const { key, window } of windows) {
    try {
      out.set(key, await vectorizeImageFromBuffer(await cropArt(imageBuffer, window)));
    } catch (err) {
      console.error("[identify] art crop failed:", err);
    }
  }
  return out;
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

  const [embedding, artVectors] = await Promise.all([
    vectorizeImageFromBuffer(imageBuffer),
    // Skipped at artWeight 0 so the documented revert is actually free: the
    // blend would be the identity there, and the forward pass pure cost.
    profile && profile.artWeight > 0
      ? embedArtViews(imageBuffer)
      : Promise.resolve(NO_ART),
  ]);
  const rows = await fetchCandidates(
    embedding,
    gameKey,
    lang,
    profile?.candidateLimit ?? LEGACY_LIMIT,
    profile?.distanceCutoff ?? LEGACY_CUTOFF,
    profile?.excludedSetIds ?? [],
    artVectors,
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
