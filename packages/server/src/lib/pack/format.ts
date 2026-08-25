/**
 * Embedding pack format.
 *
 * Embedding 23,444 Pokémon cards on a laptop CPU is a multi-hour job, and the
 * catalog sync that would do it drops a meaningful share of cards to network
 * errors. So the maintainer builds this once and ships it as a release asset.
 *
 * Layout, gzipped as a whole:
 *
 *   [4 bytes]  header length, uint32 little-endian
 *   [n bytes]  header, UTF-8 JSON
 *   [next]     count * dim float32 values, little-endian, row-major
 *   [rest]     artCount * dim more, for the cards flagged `art` in the header,
 *              in the same order
 *
 * Metadata is JSON because it is small and worth being able to read by eye;
 * the vectors are a raw float32 block because they are neither.
 */

export const PACK_SIGNATURE = "poke-sort-pack";
// v2 added collectorNumber / setTotal / data per card.
// v3 records which embedding pipeline produced the vectors.
// v4 adds the art-window vectors as a second block.
export const PACK_VERSION = 4;

export interface PackCard {
  id: string;
  name: string;
  setCode: string;
  /** Printed collector number; with setTotal reconstructs e.g. "58/102". */
  collectorNumber?: string | null;
  setTotal?: number | null;
  /** Full upstream card object — what bin rules and re-ranking read. */
  data?: unknown;
  /** Whether this card contributes a row to the art block. */
  art?: boolean;
}

export interface PackHeader {
  signature: typeof PACK_SIGNATURE;
  version: number;
  gameKey: string;
  lang: string;
  /** Embedding dimensionality; must match the model the app runs. */
  dim: number;
  count: number;
  /**
   * Rows in the art block. Carried explicitly rather than recomputed by
   * summing the per-card `art` flags: if the header were ever truncated, a
   * derived count would produce a plausible-looking wrong split of the body
   * instead of an error.
   */
  artCount: number;
  createdAt: string;
  /**
   * Which embedding pipeline produced these vectors. Checked on import — a
   * mismatch degrades every match without failing, so it has to be caught
   * before the rows land rather than diagnosed later.
   */
  model?: string;
  dtype?: string;
  preprocessing?: number;
  artWindows?: number;
  /** Sets represented, so the app can say how stale a catalog is. */
  setCodes?: string[];
  cards: PackCard[];
}

export function encodePack(
  header: Omit<PackHeader, "signature" | "version" | "count" | "artCount">,
  embeddings: number[][],
  /** Art vectors, aligned with `embeddings`; null where the card has none. */
  artEmbeddings: (number[] | null)[] = [],
): Buffer {
  const cards = header.cards.map((card, i) => ({
    ...card,
    art: artEmbeddings[i] != null ? true : undefined,
  }));
  const art = artEmbeddings.filter((vec): vec is number[] => vec != null);
  const full: PackHeader = {
    signature: PACK_SIGNATURE,
    version: PACK_VERSION,
    count: embeddings.length,
    artCount: art.length,
    ...header,
    cards,
  };

  const headerJson = Buffer.from(JSON.stringify(full), "utf-8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(headerJson.length, 0);

  const pack = (vectors: number[][], label: string): Float32Array => {
    const floats = new Float32Array(vectors.length * full.dim);
    vectors.forEach((vec, row) => {
      if (vec.length !== full.dim) {
        throw new Error(
          `${label} ${row} has ${vec.length} dims, expected ${full.dim}`,
        );
      }
      floats.set(vec, row * full.dim);
    });
    return floats;
  };

  const floats = pack(embeddings, "Embedding");
  const artFloats = pack(art, "Art embedding");

  return Buffer.concat([
    length,
    headerJson,
    Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength),
    Buffer.from(artFloats.buffer, artFloats.byteOffset, artFloats.byteLength),
  ]);
}

export function decodePack(buf: Buffer): {
  header: PackHeader;
  embeddings: Float32Array[];
  /** Aligned with `embeddings`; null for cards with no art vector. */
  artEmbeddings: (Float32Array | null)[];
} {
  if (buf.length < 4) throw new Error("Pack is truncated.");

  const headerLength = buf.readUInt32LE(0);
  const header = JSON.parse(
    buf.subarray(4, 4 + headerLength).toString("utf-8"),
  ) as PackHeader;

  if (header.signature !== PACK_SIGNATURE) throw new Error("Not a PokeSort pack.");
  if (header.version !== PACK_VERSION) {
    throw new Error(
      `Pack version ${header.version} is not supported (expected ${PACK_VERSION}).`,
    );
  }
  if (header.cards.length !== header.count) {
    throw new Error(
      `Pack header lists ${header.cards.length} cards but claims ${header.count}.`,
    );
  }

  const flagged = header.cards.filter((card) => card.art).length;
  if (flagged !== header.artCount) {
    throw new Error(
      `Pack header flags ${flagged} cards as having art but claims ${header.artCount}.`,
    );
  }

  const body = buf.subarray(4 + headerLength);
  const rowBytes = header.dim * 4;
  const expected = (header.count + header.artCount) * rowBytes;
  if (body.length !== expected) {
    throw new Error(
      `Pack body is ${body.length} bytes, expected ${expected}.`,
    );
  }

  // The body is not guaranteed to be 4-byte aligned inside the parent buffer,
  // so copy rather than aliasing it as a Float32Array view.
  const floats = new Float32Array((header.count + header.artCount) * header.dim);
  Buffer.from(floats.buffer).set(body);

  const embeddings: Float32Array[] = [];
  for (let i = 0; i < header.count; i++) {
    embeddings.push(floats.subarray(i * header.dim, (i + 1) * header.dim));
  }

  // The art block holds only the flagged cards, in card order, so walk the
  // cards and consume one row per flag to line them back up.
  const artBase = header.count * header.dim;
  const artEmbeddings: (Float32Array | null)[] = [];
  let taken = 0;
  for (const card of header.cards) {
    if (!card.art) {
      artEmbeddings.push(null);
      continue;
    }
    const start = artBase + taken * header.dim;
    artEmbeddings.push(floats.subarray(start, start + header.dim));
    taken++;
  }

  return { header, embeddings, artEmbeddings };
}
