import { describe, expect, it } from "vitest";
import { buildRerankInputs } from "../src/lib/identify";
import { collectorNumberMatch } from "../src/lib/identify/rerank";

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
