import { describe, expect, it } from "vitest";
import { buildRerankInputs } from "../src/lib/identify/candidates";
import { POKEMON_PROFILE } from "../src/lib/identify/profiles";
import {
  collectorNumberMatch,
  decideTier,
  scoreCandidate,
} from "../src/lib/identify/rerank";

/**
 * The raw readings in these tests are verbatim from real scan_events captures
 * (2026-08-13 session) — the session that exposed both failure modes: modern
 * zero-padded numbers that the bare form could never match, and confusable
 * glyph garbling of an otherwise-present number.
 */

const candidate = (collectorNumber: string, setTotal: number) => ({
  id: "test",
  name: "Test",
  collectorNumber,
  setTotal,
  setAbbreviation: null,
  hp: null,
  distance: 0.1,
});

describe("collectorNumberMatch", () => {
  it("matches the bare older-set form (58/102)", () => {
    expect(
      collectorNumberMatch(
        { collectorNumberRaw: "noise 58/102 noise" },
        candidate("58", 102),
      ),
    ).toBe(1);
  });

  it("matches a perfectly-read modern zero-padded number (020/094)", () => {
    // "020/094" does not contain "20/94" — before the padded form was
    // searched, a flawless OCR read of any modern card scored zero.
    expect(
      collectorNumberMatch(
        { collectorNumberRaw: "PFL 020/094 ©2025 Pokémon" },
        candidate("020", 94),
      ),
    ).toBe(1);
  });

  it("rescues the real garbled Ceruledge reading (oz0r09a0 → 020/094)", () => {
    const raw =
      "Creatures / GAME FREAK ot\n(ED oz0r09a0\n©2025 Pokémon / Nintendo /";
    expect(collectorNumberMatch({ collectorNumberRaw: raw }, candidate("020", 94))).toBe(
      1,
    );
  });

  it("does not manufacture matches out of prose", () => {
    // "creatures/gamefreak" normalized naively becomes digit soup containing
    // "5/94"-shaped sequences; the mostly-digits run filter must reject it.
    const raw = "©2025 Pokémon / Nintendo / Creatures / GAME FREAK";
    expect(collectorNumberMatch({ collectorNumberRaw: raw }, candidate("005", 94))).toBe(
      0,
    );
  });

  it("stays honest on a reading that never contained the number", () => {
    // Real Vibrava raw: the region text carried "59025", not "052/094".
    const raw = "I 59025 Pokémon / Nintendo BY TTLEN";
    expect(collectorNumberMatch({ collectorNumberRaw: raw }, candidate("052", 94))).toBe(
      0,
    );
  });

  it("keeps the half-credit path for a clean numerator with no denominator", () => {
    expect(
      collectorNumberMatch(
        { collectorNumber: "58", collectorNumberRaw: "junk" },
        candidate("58", 102),
      ),
    ).toBe(0.5);
  });

  it("full credit when parsed numerator and set total both agree", () => {
    expect(
      collectorNumberMatch(
        { collectorNumber: "58", setTotal: 102 },
        candidate("58", 102),
      ),
    ).toBe(1);
  });

  it("no credit when the parsed set total contradicts the candidate", () => {
    // Real Trapinch capture: 83/108 misread as "53/18". Half-crediting the
    // agreeing numerator promoted the #53 printing of the same Pokémon over
    // the true card.
    expect(
      collectorNumberMatch(
        { collectorNumber: "53", setTotal: 18 },
        candidate("53", 111),
      ),
    ).toBe(0);
  });

  it("keeps half credit when the denominator is not a real set size", () => {
    // Both from real hgss captures: 51/123 read as "51/13", 62/123 as "62/1".
    // The numerator is right and no set has 13 or 1 cards worth sorting, so
    // the denominator is a fragment, not a rival set — it must not zero the
    // one signal that was read correctly. Contrast with the "53/18" case
    // above, where 18 IS a real total and the negative inference stands.
    expect(
      collectorNumberMatch(
        { collectorNumber: "51", setTotal: 13 },
        candidate("51", 123),
      ),
    ).toBe(0.5);
    expect(
      collectorNumberMatch(
        { collectorNumber: "62", setTotal: 1 },
        candidate("62", 123),
      ),
    ).toBe(0.5);
  });

  it("zero for a different card even when digits look similar", () => {
    expect(
      collectorNumberMatch(
        { collectorNumberRaw: "020/094" },
        candidate("021", 94),
      ),
    ).toBe(0);
  });
});

describe("buildRerankInputs set abbreviation", () => {
  const row = (card_id: string, set_code: string) => ({
    card_id,
    name: "Test",
    collector_number: "1",
    set_code,
    card_data: null,
    distance: 0.1,
    set_total: 100,
  });

  it("nulls the abbreviation for sets that never printed one", () => {
    // pl2's index entry carries the PTCGO code "RR", which matched OCR garble
    // like "ERATE REBRRRR" and outranked the true card in production scans.
    const [pl2, dp6] = buildRerankInputs(
      [row("pl2-63", "pl2"), row("dp6-109", "dp6")],
      "pokemon",
    );
    expect(pl2.setAbbreviation).toBeNull();
    expect(dp6.setAbbreviation).toBeNull();
  });

  it("keeps the printed code for Sword & Shield onward", () => {
    const [swsh, me] = buildRerankInputs(
      [row("swsh1-1", "swsh1"), row("me02-020", "me02")],
      "pokemon",
    );
    expect(swsh.setAbbreviation).toBe("SSH");
    expect(me.setAbbreviation).toBe("PFL");
  });
});

/**
 * decideTier's distanceGap branch shipped unused — no profile set it, so
 * nothing exercised it. Enabling it for Pokemon makes these the tests that
 * pin which cards it may and may not release.
 */
describe("decideTier distanceGap", () => {
  const tier = (ranked: { id: string; score: number; distance: number }[]) =>
    decideTier(ranked, POKEMON_PROFILE).tier;

  it("accepts on score and margin without needing the gap", () => {
    expect(
      tier([
        { id: "a", score: 0.7, distance: 0.1 },
        { id: "b", score: 0.6, distance: 0.2 },
      ]),
    ).toBe("accept");
  });

  it("releases a thin fused margin when the image is unambiguous", () => {
    // margin 0.02 — far under minMargin — but the top pick is also the
    // nearest image match and 0.07 clear of the next.
    expect(
      tier([
        { id: "a", score: 0.7, distance: 0.05 },
        { id: "b", score: 0.68, distance: 0.12 },
      ]),
    ).toBe("accept");
  });

  it("holds when the nearest image match is not the top-scored card", () => {
    // The clause that keeps OCR from promoting a card the picture disagrees
    // with: b is nearest, a is ranked first, so the picture has not decided.
    expect(
      tier([
        { id: "a", score: 0.7, distance: 0.12 },
        { id: "b", score: 0.68, distance: 0.05 },
      ]),
    ).toBe("review");
  });

  it("holds when the next candidate is not clearly separated", () => {
    expect(
      tier([
        { id: "a", score: 0.7, distance: 0.1 },
        { id: "b", score: 0.68, distance: 0.11 },
      ]),
    ).toBe("review");
  });

  it("holds when even the nearest match is far away", () => {
    expect(
      tier([
        { id: "a", score: 0.7, distance: 0.3 },
        { id: "b", score: 0.68, distance: 0.5 },
      ]),
    ).toBe("review");
  });

  it("does not rescue a card below minScore, however clear the picture", () => {
    // The valve relaxes a thin margin, not the evidence floor. This score
    // clears reviewFloor and the gap test outright, and is still held.
    //
    // Derived from the profile rather than written as a literal: this was 0.4
    // against a minScore of 0.5, and when the art blend re-tuned minScore TO
    // 0.4 the case silently became "exactly at the floor" and started
    // accepting. The test was still right; only its constant had rotted.
    const below = POKEMON_PROFILE.accept.minScore - 0.05;
    expect(
      tier([
        { id: "a", score: below, distance: 0.05 },
        { id: "b", score: below - 0.02, distance: 0.3 },
      ]),
    ).toBe("review");
  });

  it("never rescues a card below the review floor", () => {
    expect(
      tier([
        { id: "a", score: 0.25, distance: 0.02 },
        { id: "b", score: 0.1, distance: 0.5 },
      ]),
    ).toBe("no-match");
  });
});

describe("art distance", () => {
  const row = (art_distance: number | null | undefined) => ({
    card_id: "hgss1-51",
    name: "Test",
    collector_number: "51",
    set_code: "hgss1",
    card_data: null,
    distance: 0.1,
    set_total: 123,
    art_distance,
  });

  // Number(null) is 0, and 0 is a PERFECT embedding match. If a missing art
  // vector reached the blend as 0, every card the catalog has no vector for
  // would outrank every card it does — silently, and worst on exactly the
  // half-upgraded catalogs this column is rolled out to.
  it("keeps a missing art vector null rather than zero", () => {
    expect(buildRerankInputs([row(null)], "pokemon")[0].artDistance).toBeNull();
    expect(
      buildRerankInputs([row(undefined)], "pokemon")[0].artDistance,
    ).toBeNull();
  });

  it("passes a present art distance through", () => {
    expect(buildRerankInputs([row(0.04)], "pokemon")[0].artDistance).toBe(0.04);
  });

  it("blends only the embedding signal, leaving raw distance alone", () => {
    const profile = { ...POKEMON_PROFILE, artWeight: 0.25 };
    const [candidate] = buildRerankInputs([row(0.02)], "pokemon");
    const { signals } = scoreCandidate(candidate, {}, profile);
    // 0.75 * 0.1 + 0.25 * 0.02 = 0.08, ramped against distanceCutoff 0.3.
    expect(signals.embedding).toBeCloseTo(1 - 0.08 / 0.3, 10);
    expect(candidate.distance).toBe(0.1);
  });

  it("is an exact revert at artWeight 0", () => {
    const profile = { ...POKEMON_PROFILE, artWeight: 0 };
    const withArt = buildRerankInputs([row(0.02)], "pokemon")[0];
    const without = buildRerankInputs([row(null)], "pokemon")[0];
    expect(scoreCandidate(withArt, {}, profile).signals.embedding).toBe(
      scoreCandidate(without, {}, profile).signals.embedding,
    );
  });
});
