# HGSS identification accuracy

HS-era cards identify far worse than any other era. This documents the
investigation of 2026-08-25: what was measured, what shipped, what was measured
and rejected, and what is left.

**Status:** two scoring fixes shipped (`238c2f6`, `a91e18b`, `d596aa4` on
`feat/collector-number-ocr`). Three OCR band and preprocessing changes were
rejected on measurement. The dominant remaining cause is the embedding, with a
costed recommendation that is not implemented.

---

## The problem

A Platinum sorting session ran at a **3.1%** review rate (343 accept / 11
review / 5 no-match). Switching to an HGSS pile pushed it to **35.7%**
(154 / 88 / 4).

Not a fluke. Across 1068 human verdicts in `scan_events`:

| era | n | top-1 correct | review rate |
|---|---|---|---|
| pl | 486 | 97.7% | 13.6% |
| dp | 215 | 98.1% | 7.4% |
| bw | 163 | 99.4% | 17.2% |
| **hgss** | **97** | **71.1%** | **75.3%** |

Two independent causes. The split matters, because only one is reachable by
collector-number work:

1. **The embedding is weakest on HS-era art.** Distance to truth averages
   0.0745 (pl 0.0529, dp 0.0474) while the nearest same-name reprint sits
   0.0199 away (pl 0.0383). 84 of 88 live reviews failed on **margin only** —
   the score was fine. 92 of 97 labelled hgss captures have a same-name rival.
2. **The collector number, the designed tiebreaker, is worst on hgss.** Parsed
   in 50 of 97 captures, correct in 8.

Cause 1 is roughly 25 of the 29 missing points. Cause 2 is the rest.

---

## What shipped

Measured on the 1068-capture real set at the shipped gate:

| | overall top-1 | overall accept | hgss top-1 | hgss accept | FALSE |
|---|---|---|---|---|---|
| before | 95.2% | 81.1% | 71.1% | 24.7% | 0 |
| + denominator validation | 95.4% | 81.6% | 73.2% | 26.8% | 0 |
| + `setTotal` signal | **95.6%** | **81.8%** | **74.2%** | **29.9%** | 0 |

hgss review rate **75.3% → 70.1%**. No era lost top-1; pl/dp/bw stayed at
98.6 / 98.6 / 98.8. Cliff parity holds — the `margin −0.01`, `score −0.05` and
wider-gap nudges admit 3 / 0 / 3 false accepts both before and after, so none of
this moved the pipeline closer to trouble.

### Denominator validation — `isTrustworthySetTotal`

`collectorNumberMatch` treated any disagreeing denominator as evidence against
a candidate. That is correct when the denominator names a real set and wrong
when it is OCR noise that landed after a slash. **43 of 1068 captures hit that
branch with the numerator read correctly**, and 35 of them named a total
nothing prints.

Two tests, because either alone lets the real failures through:

- **Membership** in the set index — not the catalog, because the index covers
  56 sets not synced locally and keeps the check callable from `eval/tune.ts`,
  which has no database and should keep it. Verified equal to `cards.set_total`
  on all 162 shared sets; both are tcgdex `cardCount.official`, the printed
  denominator.
- **A floor of 15**, which does the actual work. The garbled denominators are
  fragments of the real fraction: `1` sixteen times, `11` six, then 10, 9, 7,
  5, 4, 3. Membership does not catch them, because the index carries trainer
  kits, sample sheets and McDonald's inserts whose card counts genuinely *are*
  1, 5, 7, 9, 10, 11. Real rivals in the same data start at 84.

A floor of 20 was tried first and **regressed bw**: it discarded 18, a real
total (Southern Islands, Detective Pikachu), reintroducing the `53/18` misread
of 83/108 that the code already warned about. 15 is where the two clusters
separate, and every set below 15 cards is a product that does not turn up in a
bulk sorting pile.

### `setTotal` as its own signal, weight 0.02

A printed denominator narrows ~150 sets to one or two (`/90` is hgss3 alone;
`/123` is dp2 or hgss1). On the 28 labelled hgss mis-identifications, the true
card and the card that beat it print different denominators in **24**.

It is deliberately a separate signal key rather than another branch inside
`collectorNumberMatch`. `fuse` renormalises per key, so folding it in would let
a bare denominator move scores at the collector number's full weight — and a
separate key means **the revert is `weight: 0`**, something `eval:tune` can
select on its own. It declined to: `pickBest` chose 0.02 with 0 in the grid.

**What it cannot do:** every card in a set prints the same denominator, so it
never separates two candidates from the *same* set, and because `fuse`
renormalises it slightly compresses their margin. Exactly three captures moved:
`pl4-64` accept → review (its rivals are other pl4 cards), `pop8-6` and
`hgss1-51` review → accept.

---

## Measured and rejected

These are recorded because all three are easy to re-derive from the original
symptom. "HGSS reviews are high, the collector number is not being read, widen
the band" is the same reasoning that produced the seam-band revert in
`5526f2e`.

### Preprocessing (contrast → normalise) is not a real effect

This was the original headline finding and **it did not survive re-measurement**.
The "7/97 → 17/97" figure came from a marginal comparison on an eval set with
39 fewer hgss captures. Paired on the rebuilt set:

| | production | all-normalise | McNemar |
|---|---|---|---|
| hgss | 8/97 | 13/97 | **p=0.18** |
| hgss, per distinct card | — | — | 1 vs 6, **p=0.125** |
| set-wide | 269/1068 | 270/1068 | 67 vs 68, **p=1.000** |

Set-wide it is a wash: the same number of reads, redistributed. The bar was
discordant b ≥ 10 with share ≥ 80%; this is b=7, share 78%.

### Per-band preprocessing on the deep-right band does nothing

The argument was that deep-right is where hgss prints its number, so it should
get normalise. **Normalising it alone leaves hgss at 8/97, identical to
production** — the band clips the tops of the glyphs, and no preprocessing
recovers digits that were never in the crop. Mid-right instead gives 9/97 while
costing 3 reads overall.

### The taller escalation band costs two false accepts

The one genuinely significant read gain: 269 → 290 set-wide, A-only 2 versus
B-only 23, **p<0.001**. `WRONG_FULL` went 2 → 4, and measured end to end it
produces **two false accepts**:

- `dp2-113 → dp3-120` — the same card that killed the seam band in `5526f2e`,
  rediscovered independently by the rebuilt harness
- `ex13-54 → bw7-98`

For +0.7pp accept, about seven cards. Rejected under the standing rule that
false accepts are a constraint, not a term to trade against accept rate. Both
cards were flagged by `WRONG_FULL` before the expensive confirmation run, which
is good evidence the proxy metric is trustworthy.

---

## The embedding is the remaining cause

`vectorizeBuffer` runs SigLIP over the **whole card** at ~224px, where the art
window is ~100px and the frame dominates. Two printings of one Pokémon with
different art land ~0.02 apart, inside the margin gate.

Embedding-only retrieval over a 1254-card pool:

| era | whole card | art crop |
|---|---|---|
| **hgss** | **69.1%** | **96.9%** |
| pl | 99.2% | 95.7% |
| dp | 99.1% | 97.2% |
| bw | 98.2% | 94.5% |

On the 25 hgss pairs production gets wrong, the whole card ranks truth above
its rival in **1 of 25**; the art crop in **25 of 25**. Mean truth-to-rival gap
on hgss widens 0.0116 → 0.0690.

**Replacing is a wash.** Weighted by set composition both land at 95.94%, and
top-5 is ~100% under both — the two views retrieve the same cards and disagree
only on ordering. That is complementary evidence, not one being better.

**Blending wins.** With the OCR signals in play, ranking on
`0.75·d_full + 0.25·d_art`:

| art weight | hgss | pl | dp | bw |
|---|---|---|---|---|
| 0 (production) | 74.2% | 98.6% | 98.6% | 98.8% |
| **0.25** | **93.8%** | 99.4% | 96.7% | 99.4% |
| 0.5 | 95.9% | 99.2% | 97.2% | 99.4% |

**+19.6pp on hgss**, with pl and bw slightly improving; dp gives up 1.9pp
(4 cards of 215).

Two validity checks: art weight 0 reproduces production's 74.2% exactly, and
adding 485 distractors from 157 sets moved the numbers by nothing — so the crop
discriminates rather than benefiting from a small haystack.

Reproduce with `eval/art-crop-probe.ts` (needs the model and the network, not
the database; caches renders and vectors under `eval/.artprobe`).

### Cost, in the order it should be decided

1. **Art windows per era, or a detector — this is the blocker, not a detail.**
   The probe's fixed window fits dp/hgss/pl/bw. WOTC frames sit higher and
   modern sv/me frames are full-bleed, so roughly 40% of the catalog is
   untested and would likely regress.
2. **The catalog pack roughly doubles, ~66 MB → ~132 MB.** A second 768-dim
   vector is +67 MB across 21,714 cards. This is a user-facing download —
   decide it before building anything.
3. Schema: second vector column, migration, second HNSW index, one-time
   catalog re-embed (~1 hour).
4. Re-tune every threshold in `profiles.ts`; blended distances sit on a
   different scale (`distanceCutoff` 0.3 is calibrated to whole-card).
5. Latency: a second forward pass is ~170 ms against a 2 s budget that OCR
   already spends ~1.5 s of. Batching both views through SigLIP in one pass
   would help.

### Limits of this evidence

Retrieval over 1254 cards, not the real 21,714 — precision drops for both views
at full scale and the gap could move. The head-to-head with OCR is a two-way
contest, because the signals dump only carries whole-card distances for the
other 48 candidates. Read 93.8% as "of the pairs that decide hgss today, how
many flip", not as a projected top-1.

---

## Harness changes

The measurement apparatus was wrong in ways that had already caused a bad
decision. Most of `238c2f6` is fixing it.

- **`readCollectorNumber` is exported from `ocr.ts`** and `eval/ocr-sweep.ts`
  calls it. The sweep previously kept its own copy of the preprocessing and the
  band-reduction loop: pass 1 ranked bands under 3x-normalise while production
  reads them under 4x-contrast-sharpen, and it had no escalation pass at all.
  It was choosing bands for a pipeline nobody runs.
- **`WRONG_FULL`** scores each reading with the real `collectorNumberMatch`
  against truth *and every rival*, so wrongness is measured in the units the
  accept gate consumes. A hit count structurally cannot see a confidently wrong
  read — which is how seam-right shipped.
- **`eval/ocr-compare.ts`** runs the exact McNemar test on per-probe JSONL
  dumps, at probe and distinct-card level. Marginals cannot settle these
  questions.
- **Truth comes from the manifest.** `build-real-fixtures` carries the printed
  number and set total. The sweep used to derive the number from the card id's
  last segment (wrong for promo sets) and the total from the probe's own
  candidate list (null whenever the true card missed the top 50 — exactly the
  embedding-weak probes a band change targets).
- **`eval/tune.ts` reports per era**, and its grid gained `minMargin 0.05` and
  `distanceGap {0.15, 0.02}`: **the shipped gate was not in the grid**, so
  "full-set best" was scoring 4.8 points of accept rate below the live profile
  and calling itself best.
- **`ALL_SIGNALS` is exported with a compile-time completeness assertion**, so a
  signal added in `rerank.ts` and forgotten in `tune.ts` is a type error rather
  than a tuning run that silently optimises the wrong function.
- **`eval/real-set.test.ts`** replays the committed signals snapshot through the
  production reranker and fails on a false accept or a per-era top-1 drop.
  **CI now runs tests at all** — it was typecheck, lint and build.

---

## Operational notes

- **The eval flow needs the app closed** (`eval:build-real`, `eval:capture`,
  `eval:accuracy`, `eval:build`, `eval:hnsw`). `eval:tune` and `ocr-sweep` read
  JSON and images only, so they are safe with it running. Verify with
  `lsof +D packages/server/.poke-sort-catalog/db` — check its output, not its
  exit code.
- **After any rebuild, run `eval:snapshot`**, or CI silently checks a stale
  population. The raw dump is gitignored at 9.7 MB; the committed `.gz` is
  1.5 MB, and the raw file wins locally when present.
- **`real-set.test.ts` floors are calibrated to the current dump** and will need
  bumping on rebuild. That has already happened once: floored at 0.85 accept
  against a 956-capture set, where the harder 1068-capture set measures 81.8%.
  The measured values are recorded in the file so drift is visible.
- **Numbers drop across rebuilds and that is expected.** The review queue is
  worked newest-first, so each rebuild adds harder captures. Compare deltas,
  never absolutes across rebuilds.
- **`eval:capture` exits 134** (`libc++abi: mutex lock failed`) at teardown,
  *after* the data is written. It does call `disposeOcr()` before
  `process.exit(0)`, so it is a native ONNX/tesseract shutdown race rather than
  missing cleanup. Harmless to the data, but any automation wrapping it reads a
  false failure. Unfixed.
- **`eval/tune.ts`'s split-half cross-validation now takes about an hour**,
  because adding a weight quadrupled the config grid. Every gate that matters
  prints before it; the fixed-config held-out figure is the one relied on.

---

## Follow-up

1. **Implement the art-crop blend.** Decide the per-era window strategy and the
   pack-size question first; the rest is mechanical.
2. **Collect more hgss data.** 97 captures across 50 distinct cards is thin, and
   it is the set that will decide whether the art-crop work paid off. A
   deliberate session to ~200 captures / ~150 distinct roughly doubles the power
   of every future decision here.
3. Fix the `eval:capture` exit code if the eval flow is ever scripted.
4. Optional: make the tuner's cross-validation affordable again.

**Where this leaves the original problem:** the hgss review rate went 75.3% →
70.1%. Better, not fixed. **25.8% of hgss top-1s are still wrong**, and no
amount of collector-number work touches that. The art crop is the fix, and it
is a project rather than a patch.
