/**
 * Fields the identification pipeline stores alongside the embedding.
 *
 * `data` is the full upstream card object. It is what the bin rule engine
 * resolves its paths against, and what re-ranking reads for all candidates —
 * so it has to be local, not fetched per candidate at scan time.
 */
export interface SyncSourceCardExtras {
  collectorNumber?: string;
  setTotal?: number;
  data?: unknown;
}

export interface SyncSourceCard extends SyncSourceCardExtras {
  id: string;
  name: string;
  setCode: string;
  imageUrl: string | undefined;
}

export interface SyncSourceCardDetail extends SyncSourceCardExtras {
  name: string;
  setCode: string;
  imageUrl: string | undefined;
}

export interface SyncSource {
  gameKey: string;
  label: string;
  defaultUrl: string;
  fetchHeaders: Record<string, string>;
  languages: string[];
  fetchCards(
    baseUrl: string,
    addLog: (msg: string) => void,
    lang?: string,
    signal?: AbortSignal,
  ): Promise<SyncSourceCard[]>;
  fetchOne(id: string, baseUrl: string): Promise<SyncSourceCardDetail | null>;
  /**
   * Optional per-card enrichment, called from the sync workers so it overlaps
   * with the image download rather than serialising ahead of the run. A source
   * whose bulk feed already carries the full card omits this.
   */
  fetchExtras?(
    card: SyncSourceCard,
    baseUrl: string,
    signal?: AbortSignal,
  ): Promise<SyncSourceCardExtras>;
}
