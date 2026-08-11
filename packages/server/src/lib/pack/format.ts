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
 *   [rest]     count * dim float32 values, little-endian, row-major
 *
 * Metadata is JSON because it is small and worth being able to read by eye;
 * the vectors are a raw float32 block because they are neither.
 */

export const PACK_MAGIC = "mault-pack";
export const PACK_VERSION = 1;

export interface PackCard {
  id: string;
  name: string;
  setCode: string;
}

export interface PackHeader {
  magic: typeof PACK_MAGIC;
  version: number;
  gameKey: string;
  lang: string;
  /** Embedding dimensionality; must match the model the app runs. */
  dim: number;
  count: number;
  createdAt: string;
  cards: PackCard[];
}

export function encodePack(
  header: Omit<PackHeader, "magic" | "version" | "count">,
  embeddings: number[][],
): Buffer {
  const full: PackHeader = {
    magic: PACK_MAGIC,
    version: PACK_VERSION,
    count: embeddings.length,
    ...header,
  };

  const headerJson = Buffer.from(JSON.stringify(full), "utf-8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(headerJson.length, 0);

  const floats = new Float32Array(embeddings.length * full.dim);
  embeddings.forEach((vec, row) => {
    if (vec.length !== full.dim) {
      throw new Error(
        `Embedding ${row} has ${vec.length} dims, expected ${full.dim}`,
      );
    }
    floats.set(vec, row * full.dim);
  });

  return Buffer.concat([
    length,
    headerJson,
    Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength),
  ]);
}

export function decodePack(buf: Buffer): {
  header: PackHeader;
  embeddings: Float32Array[];
} {
  if (buf.length < 4) throw new Error("Pack is truncated.");

  const headerLength = buf.readUInt32LE(0);
  const header = JSON.parse(
    buf.subarray(4, 4 + headerLength).toString("utf-8"),
  ) as PackHeader;

  if (header.magic !== PACK_MAGIC) throw new Error("Not a mault pack.");
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

  const body = buf.subarray(4 + headerLength);
  const expected = header.count * header.dim * 4;
  if (body.length !== expected) {
    throw new Error(
      `Pack body is ${body.length} bytes, expected ${expected}.`,
    );
  }

  // The body is not guaranteed to be 4-byte aligned inside the parent buffer,
  // so copy rather than aliasing it as a Float32Array view.
  const floats = new Float32Array(header.count * header.dim);
  Buffer.from(floats.buffer).set(body);

  const embeddings: Float32Array[] = [];
  for (let i = 0; i < header.count; i++) {
    embeddings.push(floats.subarray(i * header.dim, (i + 1) * header.dim));
  }

  return { header, embeddings };
}
