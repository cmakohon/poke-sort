# Apple Vision OCR evaluation

Measured 2026-08-27 against the 1068-capture real set (`EVAL_FIXTURES=pokemon-real`).

**Shipped 2026-08-27.** The pipeline now reads with Apple Vision over the whole
card on macOS, and with `tesseract.js` and the era band table everywhere else.
The `tesseract` arm of every measurement below reproduces the recorded figures
exactly — 269 collector numbers on the sweep, 97.2% / 84.9% / FALSE 0 on
`eval:tune` — which is how we know the fallback is unchanged.

**All numbers below are post-correction.** The 15 mislabeled captures this work
uncovered have been fixed in `scan_events`, so the fixture set is now clean and
these figures supersede the ones measured on 2026-08-27 against the old labels.

## Summary

Apple Vision reads **3.5× more collector numbers** than Tesseract on the same
captures (936/1068 against 269), is **6.6× faster**, and takes the review pile
from 15.1% to 1.8% — at zero false accepts, with zero confidently-wrong reads.

Getting there meant fixing the eval set first. Every apparent false accept
Vision produced was a **mislabeled fixture**, not a misread: 15 captures across
13 labels, each confirmed by opening the image, now corrected in `scan_events`.

That second finding is the one with the longer tail. Some of what is written in
`profiles.ts` and `ocr.ts` as measured fact rested on those bad labels.

## Why Vision, and why it is not a drop-in

Tesseract is a *document* OCR engine: its LSTM line recogniser assumes text that
adaptive binarisation can separate from a flat background. Apple Vision is a
*scene text* engine — detection plus recognition trained on photographs, with no
binarisation step at all.

That difference is the whole result. The escalation ladder in `ocr.ts` exists
because "adaptive binarisation smears the foil texture into the glyphs"; four
hard-threshold rungs across two polarities, whose only job is to hand Tesseract
something binarisable. A scene-text model does not have that failure mode.

It is not a drop-in because everything around the engine — band geometry,
`contrast` vs `normalise`, the ladder, the narrowed parser regexes — was fitted
to Tesseract's specific failures. So the arms below vary the engine *and* how
much of that scaffolding it is asked to work through.

## The sweep (`eval/ocr-sweep.ts`)

| arm | RIGHT | HALF | WRONG_FULL | secs |
| --- | --- | --- | --- | --- |
| `production` (Tesseract) | 269/1068 | 39 | 2 | 243s |
| `vision-fullcard` | **936/1068** | 27 | **0** | 37s |

McNemar p<0.001 per probe and per distinct card. Per era, `production` →
`vision-fullcard`: **hgss 8/99 → 98/99**, pl 75/488 → 395/488, dp 50/213 →
209/213, bw 90/165 → 148/165, base 6/21 → 17/21.

Vision is better on both axes at once: 3.5x the reads *and* fewer confidently
wrong ones. Its WRONG_FULL is zero. The two that remain belong to Tesseract
(`dp7-57` read as 37/100, `pl2-85` read as 5/171) and are genuine digit slips.

On the old labels the same arms measured 883 (`vision-prod-prep`) and 874
(`vision-raw`) against 924 for `vision-fullcard`, all three showing 12
WRONG_FULL — every one of which turned out to be a bad label.

`vision-prod-prep` runs production's plan unchanged and isolates the engine.
`vision-raw` gives Vision colour crops with untouched levels. `vision-fullcard`
uses **no bands at all** — one read of the whole capture — and wins. The
era-specific band table stops being load-bearing under a recogniser that can
find the text itself.

## End-to-end (`eval:tune`, shipped profile)

`eval/recapture-ocr.ts` rewrites only the OCR half of a signals dump. Candidates
depend on the catalog, the embedding and the art windows, none of which an OCR
change touches — so holding them fixed makes any difference attributable to the
recogniser alone, and needs no database.

| arm | top1 | accept | review | FALSE | correct cards held |
| --- | --- | --- | --- | --- | --- |
| Tesseract (baseline) | 97.2% | 84.9% | 15.1% | **0** | 131 |
| Vision, banded | 99.4% | 97.8% | 2.2% | **0** | 18 |
| Vision, whole card | **99.6%** | **98.2%** | **1.8%** | **0** | **15** |

**Zero false accepts on every arm**, so the constraint that governs this
pipeline is satisfied and the accept rate is the only thing left to compare.

hgss accept goes **26.8% → 100%**. The review pile — cards the pipeline
identified correctly but held for a human anyway — goes from 131 to 15.

The baseline row is identical before and after the label corrections
(97.2 / 84.9 / 0 both times), because Tesseract was not reading those captures
at all. That is a useful check: the corrections changed what Vision is scored
against without moving the incumbent.

Signal availability, same captures: collector number 638 → 1048, printed
denominator 394 → 967, HP 336 → 886. Name is flat (1060 → 1055).

## The fixtures are mislabeled

All 13 of the "false accepts" are captures whose label names the wrong card. In
every case the pipeline identified the card **correctly** and was scored against
a bad label. Each was confirmed by opening the image.

| labelled | actually is | captures |
| --- | --- | --- |
| `dp2-113` | `dp3-120` Night Maintenance 120/132 | 2 |
| `bw10-83` | `bw2-95` Pokémon Catcher 95/98 | 1 of 3 |
| `xy0-36` | `bw2-95` Pokémon Catcher 95/98 | 1 |
| `ex13-54` | `bw7-98` Vibrava 98/149 | 1 |
| `ex10-89` | `ex15-79` Prof. Elm's Training Method 79/101 | 2 |
| `xy5-4` | `pl4-76` Tangela 76/99 | 1 |
| `dp1-50` | `pl4-41` Haunter 41/99 | 1 |
| `dp1-103` | `pop8-17` Turtwig 17/17 | 1 |
| `col1-70` | `hgss1-81` Slowpoke 81/123 | 1 |
| `ecard1-102` | `hgss1-37` Corsola 37/123 | 1 |
| `base4-56` | `base2-42` Persian 42/64 | 1 |
| `lc-90` | `base2-61` Rhyhorn 61/64 | 1 |
| `neo3-15` | `base3-16` Aerodactyl 16/62 | 1 |

13 labels, 15 captures.

**Why this happened:** fixture labels come from review-screen corrections, so a
card the reviewer accepted wrongly becomes ground truth, permanently —
corrected rows are kept forever by design. Every constant in `POKEMON_PROFILE`
was fitted against that. Fourteen of the 15 were `review_verdict = 'correct'`,
i.e. a human signing off on a wrong identification. One, `neo3-15`, is worse:
the verdict was `corrected`, and `candidates[0]` already held `base3-16` — the
right answer. The pipeline got it right and the review changed it to the wrong
card.

**A label is not a card.** `bw10-83` (Pokémon Catcher 83/101, Plasma Blast) and
`bw2-95` (Pokémon Catcher 95/98, Emerging Powers) are art-identical reprints, so
the three captures filed under `bw10-83` were not all the same physical card:
one is `bw2-95`, two are genuinely `bw10-83`. Correcting all three together —
verifying one capture and applying its answer to the label group — put two wrong
labels *in*, and `eval:tune` reported them as the only two remaining false
accepts. **Verify per capture, never per label**, and cross-check every proposed
correction against that capture's own reading before applying it:

```
# every corrected capture must agree with its own OCR read
printed(assigned card) == read(this capture)
```

That check catches the reprint trap immediately; the visual inspection alone
does not.

`eval/label-audit.ts` reproduces the detection from any sweep dump. The method
only works with a recogniser materially better than the one the labels were
collected under: when OCR reads the printed number off ~90% of captures, a read
that names a *different real card* is more likely to be a bad label than a bad
read. It nominates; a human decides.

## What this invalidates

Three comments in the identification code cite these captures as real false
accepts and use them to justify a rejection. All three have been annotated in
place, and none of the rejections should be treated as settled:

- **The seam-spanning right band** (`profiles.ts`) was reverted for two false
  accepts. One, `dp2-113 → dp3-120`, is a label error. The other, `bw9-43 →
  xy11-44`, has never been checked.
- **The taller escalation band** (`ocr.ts`) was rejected for `dp2-113 →
  dp3-120` and `ex13-54 → bw7-98`. **Both** are label errors. The comment
  describing dp2-113 as "the same card that killed the seam band, found again
  from scratch" was the same bad *label* found twice. This rejection has no
  surviving evidence behind it — and it cost a real gain of 21 reads at
  p<0.001.
- **`minMargin` 0.06** (`profiles.ts`) is held at that value because 0.05
  admits `xy0-36 → bw10-83` and `ex13-54 → bw7-98`. Both truth labels are
  wrong: that capture of `xy0-36` is `bw2-95`, and `ex13-54` is `bw7-98` — so
  the second pair was the pipeline being right. The first is a real confusion
  but between a different pair than recorded (`bw2-95` against `bw10-83`, the
  two Pokémon Catchers, which share art and differ only in the printed number).
  Whether 0.05 still admits anything under clean labels has not been
  re-measured.

Two more cards sit on the audit list without currently causing a false accept
and have not been inspected: `sm12-13` and `pl4-64`. `pl4-64` is named in
`rerank.ts` as the card `setTotal` costs an accept.

## What shipped

Vision sits behind an `OcrEngine` in `lib/identify/ocr.ts` — a recogniser
*paired with the collector-number plan it reads best under*. The pairing is the
load-bearing part: the band table exists to point Tesseract at crops it can
binarise, and a fallback that swapped the recogniser without the plan would hand
Tesseract the whole card and read the rules text as a collector number.

The engine is **probed, not assumed from `process.platform`**. A macOS build can
still lack the sidecar (no Swift toolchain on the builder) or carry one that
will not run (wrong arch, Gatekeeper), and each of those looks identical to a
present file. `probeVision()` runs one real recognition through it and falls
back on any failure. Losing the sidecar mid-run costs one degraded reading — OCR
is an enhancement, the embedding still carries the scan — and clears the cached
engine so the next scan re-resolves to Tesseract with Tesseract's bands.

Packaging: `native/vision-ocr.swift` is tracked, the binary is not;
`scripts/build-vision.mjs` compiles it during `bundle:server` and is a no-op off
macOS. `electron-builder.yml` copies the **directory** rather than the binary,
because a missing `from` fails the build with an opaque copyFiles error — that
is what keeps the Windows and Linux builds green. `adhoc-sign.mjs` already finds
any Mach-O under `Contents/` by magic bytes, so the sidecar is signed with
everything else and needed no change.

Verified end to end through `identifyCard` against the 21,714-card catalog:
`[ocr] recogniser: Apple Vision`, 150 render probes, 99.3% top-1, 97.3%
accepted, **0 false accepts**.

## Why the accept gate did not move

`eval:tune`'s full grid finds a better gate for Vision than the one that ships:
same weights, `minMargin` 0.03 and no `distanceGap`, for **99.0% accept at zero
false accepts** against the shipped 98.2%. It was not taken, for two reasons.

**It sits one notch from the cliff.** At `minMargin` 0.02 the same config admits
a false accept. `profiles.ts` already records why that disqualifies a config:
the sweep argmax "sat one margin notch from a config with 2 false accepts, and a
procedure-level cross-validation showed argmax-picking leaks false accepts on
held-out halves". This run reproduces that — split-half CV over 40 splits puts
the *selection procedure* at 23/21360 held-out false accepts (0.1%) for Vision
and 28/21360 for Tesseract. The grid best is optimistic by construction.

**The gate is shared, and the two engines disagree about it.**
`POKEMON_PROFILE.accept` serves whichever engine resolved, so loosening it for
Vision loosens it for the Tesseract fallback on Windows and Linux — where it is
not free:

| gate | Vision accept | Vision FALSE | Tesseract accept | Tesseract FALSE | fixed-config held-out |
| --- | --- | --- | --- | --- | --- |
| **shipped** (score .4, margin .06, +dgap) | **98.2%** | **0** | **85.0%** | **0** | **0/21360** |
| score .45, margin .04 | 98.6% | 0 | 89.5% | **2** | **34/21360** |
| score .4, margin .03 (grid best) | 99.0% | 0 | — | — | 0/21360 |

Buying Vision another 0.4 points would hand the fallback two false accepts on
this set and a 34/21360 held-out leak. False accepts are a constraint here, not
a term, so the answer is no.

Worth noting for the record: the Tesseract full-set best **is** the shipped
gate. The incumbent was already at its own optimum, which is why adopting Vision
needed no re-tuning at all — the extra accepts come from reading more numbers,
not from a looser gate.

**If that last 0.8% is ever wanted it needs a per-engine gate**, because these
two gates are not compatible. That is a real change with its own validation
burden, not a constant to nudge.

## Status

The labels are corrected and `eval:tune` returns **zero false accepts on every
arm**, so the result above is certified against the objective that governs this
pipeline.

Before the corrections, `eval:tune` terminated with *"no zero-false
configuration found"* — its objective was unsatisfiable while correct
identifications were scored as failures. That is the shape of this class of bug:
it does not look like bad data, it looks like an unachievable target.

Open items:

1. **Re-measure the two bands** rejected on evidence now known to be bad. They
   only affect the Tesseract fallback now, which lowers the stakes but does not
   make the record less wrong.
2. **`collection_cards`.** 14 of the 15 corrected captures have a collection
   row still carrying the wrong `card_id` *and* a stale denormalised `card`
   object, so the collection shows the wrong card at the wrong price. Fixing it
   needs the app's own correction path (which rewrites `card`, re-prices the
   printing, and preserves `originalCardId`), not a bare id swap.
3. **Two uninspected audit candidates**, `sm12-13` and `pl4-64`.
4. **Per-word confidence.** Vision returns it and nothing reads it. That is the
   "new evidence about telling a garbled read from a clean one" the `ocr.ts`
   comment asks for before re-litigating band width.

## Harness and code

- `eval/vision/vision-ocr.swift` — a long-lived sidecar over
  `VNRecognizeTextRequest`, `.accurate`, `usesLanguageCorrection = false`
  (language correction would "fix" `58/102` into a word). One request per line
  so model load is paid once. Built on demand; the binary is gitignored.
- `eval/vision-ocr.ts` — pooled adapter implementing `TextRecognizer`. Records
  per-read confidence, which Vision returns and nothing yet uses.
- `src/lib/identify/ocr.ts` — a `TextRecognizer` seam plus a `raw` read option.
  Both default to the shipping behaviour.
- `eval/recapture-ocr.ts`, `eval/label-audit.ts` — as above.

**Vision is macOS-only.** That is exactly why the seam is a seam rather than a
replacement: Tesseract stays the recogniser everywhere else, so adopting Vision
does not cost the Windows/Linux builds. An unmeasured but cross-platform
alternative, if that fallback ever needs to be better, is PaddleOCR/RapidOCR
under ONNX Runtime — `onnxruntime-node` is already in the tree via
`@huggingface/transformers`.

**Not yet measured:** whether Vision's per-word confidence can distinguish a
garbled read from a clean one. That is the "new evidence" the `ocr.ts` comment
asks for before re-litigating band width, and it is already being returned and
discarded.
