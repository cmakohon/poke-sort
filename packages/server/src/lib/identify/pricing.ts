import type { PlayingCard } from "@poke-sort/shared";
import { eq } from "drizzle-orm";
import { LIVE_PRICING, PRICE_TIMEOUT_MS } from "../../config";
import { db } from "../../db";
import { cardImageVectors } from "../../db/schema";
import { resolveAdapterForGame } from "../card-search/resolve";

/**
 * Refreshes the price of an identified card from its upstream source.
 *
 * Candidates are hydrated from `card_data` stored at sync time, which makes
 * everything work offline — but freezes pricing at whenever the catalog was
 * built. That matters because bin rules can route on price ("price_usd > 5 ->
 * bin 3"), and the bin decision happens the moment the card is identified. A
 * price refreshed after the fact would arrive too late to affect where the card
 * physically went.
 *
 * So this runs inside the identify request, and is deliberately bounded:
 * - the per-game adapter is already wrapped in a 15-minute TTL cache, which
 *   also dedupes concurrent lookups of the same card
 * - a short timeout, after which the stored price stands
 * - failure is never fatal; offline scanning keeps working with stored prices
 *   (the one thing the plan always accepted would need the network)
 */

/**
 * Races a promise against a timeout without leaving the loser unhandled.
 *
 * Deliberately does not cancel the loser. The adapter behind it dedupes
 * concurrent lookups of the same card onto one shared promise, so aborting here
 * would reject that promise for every other caller waiting on it — turning one
 * scan's timeout into everyone's. The abandoned request is instead left to
 * finish and populate the 15-minute cache, where the next scan of the same card
 * gets it for free.
 *
 * What that leaves unbounded is the socket itself, so the request carries its
 * own deadline at the fetch (see POKEMON_HEADERS / fetchDetail).
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

/**
 * Fetches the current upstream card. Returns null when live pricing is off,
 * the game has no adapter, or the lookup does not finish in time.
 */
export async function fetchFreshCard(
  gameKey: string,
  cardId: string,
): Promise<PlayingCard | null> {
  if (!LIVE_PRICING) return null;

  const resolved = await resolveAdapterForGame(gameKey);
  if (!resolved) return null;

  const result = await withTimeout(
    resolved.adapter.searchById(cardId, resolved.baseUrl),
    PRICE_TIMEOUT_MS,
  );
  return result?.success ? (result.data ?? null) : null;
}

/**
 * Writes the refreshed upstream object back to the catalog, so a later offline
 * scan of the same card sees a newer price than the one the pack shipped with.
 * Fire-and-forget: this must never delay a scan.
 */
export function persistRefreshedCard(cardId: string, fresh: PlayingCard): void {
  if (!fresh.raw) return;
  void db
    .update(cardImageVectors)
    .set({ cardData: fresh.raw, updatedAt: new Date() })
    .where(eq(cardImageVectors.cardId, cardId))
    .catch((err) => {
      console.error("[pricing] Could not persist refreshed card data:", err);
    });
}

/** Applies a fresh price to a hydrated card, leaving everything else alone. */
export function withFreshPrice(
  card: PlayingCard | null,
  fresh: PlayingCard | null,
): PlayingCard | null {
  if (!card) return card;
  if (!fresh || fresh.price == null) return card;
  return { ...card, price: fresh.price };
}
