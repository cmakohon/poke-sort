import type { SyncState, SyncStatus } from "@magic-vault/shared";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { cardImageVectors } from "../db/schema";
import { gundamSyncSource } from "./gundam/sync";
import { pokemonSyncSource } from "./pokemon/sync";
import { scryfallSyncSource } from "./scryfall/sync";
import type { SyncSource } from "./card-search/sync-types";
import { resolveGameDataSourceUrl } from "./card-search/resolve";
import { sendDiscordNotification } from "./discord";
import { vectorizeImageFromBuffer } from "./vectorize";

export const SYNC_SOURCES: Record<string, SyncSource> = {
  mtg: scryfallSyncSource,
  gundam: gundamSyncSource,
  pokemon: pokemonSyncSource,
};

type SseWriter = (event: string, data: unknown) => void;

let state: SyncState = {
  status: "idle",
  gameKey: "",
  total: 0,
  processed: 0,
  skipped: 0,
  errors: 0,
  startedAt: null,
  logs: [],
};

let cancelFlag = false;
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
  }
}

export function startSync(orgId: string | undefined, gameKey: string): void {
  if (state.status === "running") return;

  const source = SYNC_SOURCES[gameKey];
  if (!source) return;

  cancelFlag = false;
  state = {
    status: "running",
    gameKey,
    total: 0,
    processed: 0,
    skipped: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
    logs: [],
  };

  emit("status", getStatus());
  runSync(source).catch((err) => {
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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSync(source: SyncSource): Promise<void> {
  const baseUrl = await resolveGameDataSourceUrl(source.gameKey, source.defaultUrl);
  addLog(`Using data source: ${baseUrl}`);

  const cards = await source.fetchCards(baseUrl, addLog);
  state = { ...state, total: cards.length };
  emit("status", getStatus());

  addLog(`Loading existing ${source.label} cards from DB...`);

  const existing = await db
    .select({ id: cardImageVectors.scryfallId })
    .from(cardImageVectors)
    .where(eq(cardImageVectors.gameKey, source.gameKey));
  const existingSet = new Set(existing.map((r) => r.id));

  addLog(
    `Found ${existingSet.size} existing ${source.label} cards in DB. Starting vectorization...`,
  );

  for (const card of cards) {
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

    if (!card.imageUrl || existingSet.has(card.id)) {
      state = { ...state, skipped: state.skipped + 1 };
      emit("progress", {
        processed: state.processed,
        skipped: state.skipped,
        errors: state.errors,
        currentCard: card.name,
      });
      continue;
    }

    try {
      const imageRes = await fetch(card.imageUrl, { headers: source.fetchHeaders });
      if (!imageRes.ok) throw new Error(`Image fetch failed: ${imageRes.status}`);
      const buffer = Buffer.from(await imageRes.arrayBuffer());
      const embedding = await vectorizeImageFromBuffer(buffer);

      await db
        .insert(cardImageVectors)
        .values({
          scryfallId: card.id,
          gameKey: source.gameKey,
          name: card.name,
          setCode: card.setCode,
          embedding,
        })
        .onConflictDoNothing();

      existingSet.add(card.id);
      state = { ...state, processed: state.processed + 1 };
      addLog(
        `[${state.processed + state.skipped}/${state.total}] ${card.name} (${card.setCode})`,
      );
      emit("progress", {
        processed: state.processed,
        skipped: state.skipped,
        errors: state.errors,
        currentCard: card.name,
      });

      await sleep(100);
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
