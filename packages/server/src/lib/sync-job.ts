import type { SyncState, SyncStatus } from "@magic-vault/shared";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { cardImageVectors } from "../db/schema";
import { resolveGameDataSourceUrl } from "./card-search/resolve";
import type { SyncSource, SyncSourceCard } from "./card-search/sync-types";
import { sendDiscordNotification } from "./discord";
import { invalidateFacets } from "./facets";
import { pokemonSyncSource } from "./pokemon/sync";
import { scryfallSyncSource } from "./scryfall/sync";
import { vectorizeImageFromBuffer } from "./vectorize";

export const SYNC_SOURCES: Record<string, SyncSource> = {
  mtg: scryfallSyncSource,
  pokemon: pokemonSyncSource,
};

type SseWriter = (event: string, data: unknown) => void;

let state: SyncState = {
  status: "idle",
  gameKey: "",
  lang: "en",
  total: 0,
  processed: 0,
  skipped: 0,
  errors: 0,
  startedAt: null,
  logs: [],
};

let cancelFlag = false;
let abortController: AbortController | null = null;
const writers = new Set<SseWriter>();

function addLog(msg: string) {
  state = { ...state, logs: [...state.logs.slice(-199), msg] };
  emit("log", { line: msg });
}

function emit(event: string, data: unknown) {
  for (const writer of writers) {
    try {
      writer(event, data);
    } catch {
      // writer may have disconnected
    }
  }
}

export function getStatus(): SyncState {
  return { ...state, logs: [...state.logs] };
}

export function subscribeSSE(writer: SseWriter): () => void {
  writers.add(writer);
  writer("status", getStatus());
  return () => writers.delete(writer);
}

export function cancelSync(): void {
  if (state.status === "running") {
    cancelFlag = true;
    abortController?.abort();
  }
}

export function startSync(
  orgId: string | undefined,
  gameKey: string,
  lang: string = "en",
): void {
  if (state.status === "running") return;

  const source = SYNC_SOURCES[gameKey];
  if (!source) return;
  if (!source.languages.includes(lang)) return;

  cancelFlag = false;
  abortController = new AbortController();
  state = {
    status: "running",
    gameKey,
    lang,
    total: 0,
    processed: 0,
    skipped: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
    logs: [],
  };

  emit("status", getStatus());
  runSync(source, lang).catch((err) => {
    state = { ...state, status: "failed" };
    const msg = err instanceof Error ? err.message : String(err);
    addLog(`Fatal error: ${msg}`);
    emit("error", { message: msg });
    if (orgId) {
      void sendDiscordNotification(orgId, {
        title: "Magic Vault — Sync Failed",
        description: `The card database sync job encountered a fatal error.\n\n**Error:** ${msg}`,
        color: 0xed4245,
        timestamp: new Date().toISOString(),
      });
    }
  });
}

// Lowered from 10: the embedding forward pass (~400 ms) dominates, not the
// download, so extra download concurrency bought little and provoked the CDN.
const VECTORIZE_CONCURRENCY = parseInt(
  process.env.VECTORIZE_CONCURRENCY ?? "4",
);

/** Rows per insert statement. ~250 x 768 floats keeps a statement near 2 MB. */
const WRITE_BATCH_SIZE = 250;

/**
 * A full Pokémon sync at concurrency 10 lost ~18% of cards to bare
 * `fetch failed` errors — connection resets from the image CDN, not 404s.
 * Those cards were counted as errors and silently never embedded, leaving an
 * incomplete catalog. Retrying with backoff, and asking for less at once,
 * is what makes the fallback path trustworthy when no pack is available.
 */
const FETCH_ATTEMPTS = 4;
const FETCH_BACKOFF_MS = 500;

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function fetchImageWithRetry(
  url: string,
  headers: Record<string, string> | undefined,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    if (cancelFlag) throw new Error("cancelled");
    try {
      const res = await fetch(url, {
        headers,
        signal: abortController?.signal,
      });
      // 4xx other than 429 is a real "this image does not exist" — retrying
      // just wastes the rate limit we are already up against.
      if (res.ok) return res;
      if (res.status < 500 && res.status !== 429) {
        throw new Error(`Image fetch failed: ${res.status}`);
      }
      lastError = new Error(`Image fetch failed: ${res.status}`);
    } catch (err) {
      if (abortController?.signal.aborted) throw err;
      lastError = err;
    }

    if (attempt < FETCH_ATTEMPTS) {
      // Exponential with jitter, so the workers do not retry in lockstep.
      const delay = FETCH_BACKOFF_MS * 2 ** (attempt - 1);
      await sleep(delay + Math.floor(Math.random() * delay));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function runSync(source: SyncSource, lang: string): Promise<void> {
  const baseUrl = await resolveGameDataSourceUrl(
    source.gameKey,
    source.defaultUrl,
  );
  addLog(`Using data source: ${baseUrl}`);

  let cards: Awaited<ReturnType<SyncSource["fetchCards"]>>;
  try {
    cards = await source.fetchCards(
      baseUrl,
      addLog,
      lang,
      abortController?.signal,
    );
  } catch (err) {
    if (cancelFlag) {
      state = { ...state, status: "cancelled" };
      addLog("Sync cancelled by user.");
      emit("done", {
        status: "cancelled" as SyncStatus,
        processed: state.processed,
        skipped: state.skipped,
        errors: state.errors,
      });
      return;
    }
    throw err;
  }
  state = { ...state, total: cards.length };
  emit("status", getStatus());

  addLog(`Loading existing ${source.label} cards from DB...`);

  const existing = await db
    .select({ id: cardImageVectors.scryfallId })
    .from(cardImageVectors)
    .where(eq(cardImageVectors.gameKey, source.gameKey));
  const existingSet = new Set(existing.map((r) => r.id));

  addLog(
    `Found ${existingSet.size} existing ${source.label} cards in DB. Starting vectorization (${VECTORIZE_CONCURRENCY} in parallel)...`,
  );

  // PGlite serialises everything through a single connection, so the workers
  // below only fetch and embed in parallel — the writes funnel through one
  // batched, chained writer. This also replaces the previous row-at-a-time
  // insert, which was the slower pattern even against Neon.
  let pending: (typeof cardImageVectors.$inferInsert)[] = [];
  let writeChain: Promise<void> = Promise.resolve();

  async function writeBatch(
    batch: (typeof cardImageVectors.$inferInsert)[],
  ): Promise<void> {
    try {
      await db.insert(cardImageVectors).values(batch).onConflictDoNothing();
      state = { ...state, processed: state.processed + batch.length };
    } catch (err) {
      state = { ...state, errors: state.errors + batch.length };
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`Error: batch of ${batch.length} failed to write: ${msg}`);
    }
    emit("progress", {
      processed: state.processed,
      skipped: state.skipped,
      errors: state.errors,
    });
  }

  /** Chained, so only one write is ever in flight. */
  function flush(): Promise<void> {
    if (pending.length === 0) return writeChain;
    const batch = pending;
    pending = [];
    writeChain = writeChain.then(() => writeBatch(batch));
    return writeChain;
  }

  async function processCard(card: SyncSourceCard): Promise<void> {
    if (!card.imageUrl || existingSet.has(card.id)) {
      state = { ...state, skipped: state.skipped + 1 };
      emit("progress", {
        processed: state.processed,
        skipped: state.skipped,
        errors: state.errors,
        currentCard: card.name,
      });
      return;
    }

    try {
      // Detail fetch runs alongside the image download rather than after it.
      const [imageRes, extras] = await Promise.all([
        fetchImageWithRetry(card.imageUrl, source.fetchHeaders),
        source.fetchExtras?.(card, baseUrl, abortController?.signal) ?? card,
      ]);
      const buffer = Buffer.from(await imageRes.arrayBuffer());
      const embedding = await vectorizeImageFromBuffer(buffer);

      // Claim the id immediately so a duplicate in the same run is skipped
      // rather than embedded twice while this one sits in the buffer.
      existingSet.add(card.id);
      pending.push({
        scryfallId: card.id,
        gameKey: source.gameKey,
        lang,
        name: card.name,
        setCode: card.setCode,
        embedding,
        collectorNumber: extras.collectorNumber ?? null,
        setTotal: extras.setTotal ?? null,
        cardData: extras.data ?? null,
      });
      addLog(`[${state.total}] embedded ${card.name} (${card.setCode})`);

      if (pending.length >= WRITE_BATCH_SIZE) await flush();
    } catch (err) {
      state = { ...state, errors: state.errors + 1 };
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`Error: ${card.name}: ${msg}`);
      emit("progress", {
        processed: state.processed,
        skipped: state.skipped,
        errors: state.errors,
        currentCard: card.name,
      });
    }
  }

  let nextIndex = 0;
  let cancelled = false;

  async function worker(): Promise<void> {
    for (;;) {
      if (cancelFlag) {
        cancelled = true;
        return;
      }
      const index = nextIndex++;
      if (index >= cards.length) return;
      await processCard(cards[index]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(VECTORIZE_CONCURRENCY, cards.length) },
      worker,
    ),
  );

  // Drain whatever the last partial batch left behind — including on cancel,
  // so work already paid for in embedding time is not thrown away.
  await flush();
  await writeChain;

  // The catalog changed, so any cached facet lists are stale.
  invalidateFacets();

  if (cancelled) {
    state = { ...state, status: "cancelled" };
    addLog("Sync cancelled by user.");
    emit("done", {
      status: "cancelled" as SyncStatus,
      processed: state.processed,
      skipped: state.skipped,
      errors: state.errors,
    });
    return;
  }

  state = { ...state, status: "completed" };
  addLog(
    `Done. Processed: ${state.processed}, Skipped: ${state.skipped}, Errors: ${state.errors}`,
  );
  emit("done", {
    status: "completed" as SyncStatus,
    processed: state.processed,
    skipped: state.skipped,
    errors: state.errors,
  });
}
