/**
 * The guards that run before the query does.
 *
 * page/limit arrive as query-string text and reach an OFFSET, so a `?page=abc`
 * that survives as NaN produces `OFFSET NaN` — and PGlite executes on the main
 * thread with no way to cancel, so a malformed request is not a 500, it is a
 * stalled sorter. The short-circuits below are what keep that impossible; the
 * ranked query itself is exercised against the real catalog by hand.
 */
import { QUERY_MIN_LENGTH } from "@poke-sort/shared";
import { describe, expect, it } from "vitest";
import {
  SEARCH_PAGE_SIZE,
  searchLocalCatalog,
} from "../src/lib/card-search/local";

const base = { gameKey: "pokemon", lang: "en" };

describe("correction search guards", () => {
  it("answers a too-short query without touching the database", async () => {
    // One character below the client's own floor. Matching '%a%' across the
    // whole catalog is a scan the trigram index cannot help with.
    const short = "x".repeat(QUERY_MIN_LENGTH - 1);
    const page = await searchLocalCatalog({ ...base, query: short });
    expect(page).toEqual({
      cards: [],
      total: 0,
      page: 1,
      limit: SEARCH_PAGE_SIZE,
      sets: [],
    });
  });

  it("treats whitespace as empty", async () => {
    const page = await searchLocalCatalog({ ...base, query: "   " });
    expect(page.cards).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("reports the page it actually used when asked for nonsense", async () => {
    // Number("abc") is NaN, and Math.max(1, NaN) is NaN — the clamp has to
    // check for a finite number, not just take the larger of the two.
    const page = await searchLocalCatalog({
      ...base,
      query: "x",
      page: Number("abc"),
      limit: Number("?"),
    });
    expect(page.page).toBe(1);
    expect(page.limit).toBe(SEARCH_PAGE_SIZE);
  });

  it("clamps a page size that would return the whole catalog", async () => {
    const page = await searchLocalCatalog({
      ...base,
      query: "x",
      limit: 100_000,
    });
    expect(page.limit).toBeLessThanOrEqual(200);
    expect(page.limit).toBeGreaterThan(0);
  });
});
