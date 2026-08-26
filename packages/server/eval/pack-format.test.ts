import { describe, expect, it } from "vitest";
import {
  decodePack,
  encodePack,
  PACK_VERSION,
  type PackCard,
} from "../src/lib/pack/format";

const DIM = 4;

const card = (id: string): PackCard => ({
  id,
  name: id.toUpperCase(),
  setCode: id.split("-")[0],
});

// Quarter steps, which are exact in float32 — the block is stored as float32.
const vec = (seed: number) => Array.from({ length: DIM }, (_, i) => seed + i / 4);

const header = (cards: PackCard[]) => ({
  gameKey: "pokemon",
  lang: "en",
  dim: DIM,
  createdAt: "2026-08-25T00:00:00.000Z",
  cards,
});

describe("pack v4 art block", () => {
  const cards = [card("hgss1-1"), card("hgss1-2"), card("tcgp-1")];
  const full = [vec(1), vec(2), vec(3)];

  it("round-trips both blocks and lines art up with its card", () => {
    // Middle card has no art, so a decoder that walked the art block by index
    // rather than by flag would hand card 3's vector to card 2.
    const art = [vec(10), null, vec(30)];
    const { header: h, embeddings, artEmbeddings } = decodePack(
      encodePack(header(cards), full, art),
    );

    expect(h.version).toBe(PACK_VERSION);
    expect(h.count).toBe(3);
    expect(h.artCount).toBe(2);
    expect(embeddings.map((e) => [...e])).toEqual(full);
    expect(artEmbeddings[0] && [...artEmbeddings[0]]).toEqual(vec(10));
    expect(artEmbeddings[1]).toBeNull();
    expect(artEmbeddings[2] && [...artEmbeddings[2]]).toEqual(vec(30));
  });

  it("round-trips a pack with no art vectors at all", () => {
    const { header: h, artEmbeddings } = decodePack(encodePack(header(cards), full));
    expect(h.artCount).toBe(0);
    expect(artEmbeddings).toEqual([null, null, null]);
  });

  it("rejects a body whose length disagrees with the header", () => {
    const buf = encodePack(header(cards), full, [vec(10), null, vec(30)]);
    expect(() => decodePack(buf.subarray(0, buf.length - DIM * 4))).toThrow(
      /body is \d+ bytes/,
    );
  });

  it("rejects a v3 pack outright", () => {
    const buf = encodePack(header(cards), full);
    const headerLength = buf.readUInt32LE(0);
    const parsed = JSON.parse(buf.subarray(4, 4 + headerLength).toString("utf-8"));
    parsed.version = 3;
    const rewritten = Buffer.from(JSON.stringify(parsed), "utf-8");
    const length = Buffer.alloc(4);
    length.writeUInt32LE(rewritten.length, 0);
    expect(() =>
      decodePack(Buffer.concat([length, rewritten, buf.subarray(4 + headerLength)])),
    ).toThrow(/version 3 is not supported/);
  });
});
