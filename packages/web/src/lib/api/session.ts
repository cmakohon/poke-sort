import { API_BASE } from "@/lib/api/client";

export async function createSessionEventSource(
  collectionGuid: string,
): Promise<EventSource> {
  return new EventSource(
    `${API_BASE}/api/collections/${encodeURIComponent(collectionGuid)}/stream`,
  );
}

export async function createLockEventsSource(): Promise<EventSource> {
  return new EventSource(`${API_BASE}/api/collections/lock-events`);
}
