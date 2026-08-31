# DexFlip gate answers — from the poke-sort engine

Answered from the code (`packages/server/src/lib/identify/`,
`packages/web/src/features/scanner/lib/`) and from measurements run against
the real catalog and the 1068-capture labelled eval set on 2026-08-31.
Anything not measured is marked so.

**One framing fact first**: the engine is not a single model. It is a
pipeline — SigLIP image embedding (whole card + art window, blended) →
nearest-neighbour retrieval over a 19,448-card index → Apple Vision OCR →
weighted signal fusion → an accept/review/no-match gate. And it is currently
TypeScript + ONNX + Postgres, not Swift; what ships to DexFlip is a port, not
a copy. The pure logic ports mechanically (done, in `Sources/`); the embedder
must become Core ML, and that carries a hard constraint described in G7.

---

## G1. What does the engine expect to be looking at? [BLOCKING]

**a. It needs the card cropped out of the frame. It cannot locate a card in a
scene.** There is no detection stage anywhere in the pipeline. Every geometric
constant — the OCR name band at y 4.5–13%, the collector-number bands at
y 89–99.5%, the art window at y 12–55% — is a *fraction of the input image*
(`profiles.ts`, `art-window.ts`). Hand it your full 3024×4032 frame and it
will OCR the table and embed the scene; the whole-card embedding, where the
card frame is the dominant signal, degrades to garbage.

**b. It needs perspective correction, not just a bounding box.** The sorter
never feeds the engine a raw frame: the web client perspective-warps the card
quad to a flat upright rectangle first (`extractCardImage` in
`card-detection.ts` — a full projective homography, bilinear-sampled). A
plain axis-aligned crop of a tilted handheld shot would shear every band off
its geometry and shift the embedding domain away from everything in the index
(which is built from flat card renders).

**c. Target size: 745×1043 (2.5:3.5 aspect).** That is the sorter's exact
warp output, and every accuracy number below was earned at it. It is
comfortable, not minimal: SigLIP squash-resizes to 512×512 anyway, and Vision
reads the number band fine at this scale. The falloff floor below 745 has
never been measured (nothing smaller has ever been fed in). Your framing
guide yields a ~1500×2100 card region — downsampling that to 745×1043 during
the warp is the known-good configuration, and it also means the pixels
surviving your 2560px stored copy are more than sufficient (see G12).

**d. Fixed orientation: upright, name at top — with one built-in exception.**
SigLIP is not rotation invariant and the OCR bands read fixed corners. The
engine itself recovers 180° (upside-down) input: when a pass's nearest
distance exceeds 0.2 it retries on the rotated image and keeps the better
pass, remembering the winning orientation for the next call
(`identifyCard`). 90° sideways input is *not* recovered and will whiff. Since
DexFlip's deskew step produces the upright card, this costs you nothing —
just map the quad corners so "top" is the card's top; if the user shoots
upside down, the retry absorbs it at the cost of one extra pass.

**e. Accuracy on handheld frames: unknown — genuinely, not politely.** Every
number in this document comes from a fixed webcam under fixed lighting. What
the measurements *do* say: on 1068 real (not rendered) captures at the
contract input above, top-1 is 99.6% with 0 false accepts. The failure modes
a handheld phone adds — glare on holofoil, motion blur, sleeve reflections,
warped cards that defeat the flat homography — are exactly the ones OCR and
the embedding are sensitive to, and the OCR signals are what carry reprint
disambiguation. Order-of-magnitude expectation *if the deskewed crop is
clean*: same ballpark for top-1 (the embedding is robust and 12 MP of phone
glass beats the sorter's webcam), with the review-ish share (sub-threshold
margins) likely growing several-fold from its current 1.8%. Against your
targets (≤20% correction, ≤5% whiff) there is real headroom, but confirming
it needs the eval described in the README: ~200 labelled captures through
DexFlip's own capture path. Do not ship a number that was never measured.

**Recommendation (the Part-5 item 2 answer), precisely:**
DexFlip routes the quad from its existing `VNDetectRectanglesRequest` into
the call. The engine receives either
(1) the full-resolution frame **plus the four corner points** (preferred —
`identify(_:cardQuad:)` in the delivered Swift; the engine does the
perspective warp itself with CIPerspectiveCorrection so the warp stays inside
the boundary and can never drift from the band geometry), or
(2) a pre-warped upright card image at 745×1043, card filling the image edge
to edge, name at top.
Either way: perspective-corrected, not a bare bounding box; 2.5:3.5 aspect;
orientation upright (180° self-recovers, 90° does not). This is an amendment
to the contract and worth making deliberately now — the delivered
`identify(_ image: Data)` fallback runs its own rectangle detection, but then
you are running detection twice and trusting the engine's tuning of it
instead of the one you already display to the user.

## G2. Image encoding and EXIF orientation [BLOCKING]

**a.** `Data` is fine, but it is the worst of the three options: the engine
immediately decodes it, and you already hold a decoded buffer. If the
contract is being amended anyway (G1), pass `CGImage` + quad and skip a HEIC
encode/decode round trip on the capture path. Keep `Data` only if you value
the seam's simplicity over ~50–100 ms and some memory churn.

**b. Orientation: the current engine does *not* honour EXIF** — the Node
pipeline (sharp without `.rotate()`, transformers.js `RawImage`) reads raw
pixel order; it never mattered because the sorter's canvas pixels carry no
EXIF. Your instinct is right that this is the classic failure. The delivered
Swift decodes through ImageIO and **explicitly bakes the EXIF orientation in
before anything else touches the pixels** (`decodeHonoringOrientation`).
If you adopt the CGImage hand-off, orientation becomes your side of the
boundary: pass pixels that are already upright, and the quad in the same
coordinate frame.

**c. Display P3: no problem in principle, unvalidated in practice.** There is
no colour management anywhere in the pipeline — bytes go straight into
SigLIP's [-1,1] normalisation. P3 and sRGB agree closely for the desaturated
regions and diverge only on saturated primaries; the catalog embeddings came
from sRGB-ish renders, so a P3-decoded capture adds a small consistent bias.
The cheap, correct move is to convert to sRGB during the deskew render (one
flag in CIContext) and eliminate the question. Cost: nothing. The parity
harness should still include a few saturated cards.

**d. Aspect ratio:** the engine assumes the input *is* a 2.5:3.5 card. It
never checks; a wrong aspect silently shears the band geometry. The deskew
step pins this.

## G3. Identifiers [BLOCKING]

**a. It returns TCGdex ids natively.** The catalog *is* TCGdex
(`api.tcgdex.net/v2/en/cards`); `card_id` values are exactly your key space
(`base1-4`, `swsh3-136`, `me02-062`). No mapping table exists because none is
needed. `Candidate.tcgdexCardId` is populated verbatim.

**b.** N/A — but one ownership note: id *coverage* tracks the sorter's
catalog sync, so "does DexFlip's catalogue know this id" is only guaranteed
if both sides pin compatible TCGdex snapshots. Version the index (it already
carries an identity header) and check it against your catalogue build.

## G4. What is confidence? [BLOCKING]

**a.** Neither a probability nor a raw similarity: a **weighted mean of
bounded signals, already in 0…1, higher is better**. The embedding signal is
`1 − cosineDistance/0.3` (clamped); OCR signals are match scores in {0, 0.5,
1} (name is edit-distance similarity in [0,1]); fusion renormalises over the
signals that were actually informative for that capture. No transform needed;
ranking is already descending in it.

**b. Comparable across cards: yes, with one honest caveat.** The engine's own
accept gate applies the same absolute thresholds (score ≥ 0.4) to every card
ever scanned, which only works because scores are cross-call comparable. The
caveat: renormalisation means a capture where OCR read nothing is scored on
fewer signals than one where it read everything, so a 0.8 image-only score
carries less evidence than a 0.8 with a matched collector number. For queue
*ordering* this is fine. For queue *triage* the margin is strictly better —
see (d).

**c. Thresholds — the engine decides, and you should surface its decision.**
Internally: fused score < 0.3 → no-match; ≥ 0.4 *and* margin over the
runner-up ≥ 0.06 (or an unambiguous-image release valve) → accept; else →
review. The delivered service maps no-match to your empty-array whiff. But
the accept/review distinction is the most valuable thing the engine computes
— it is calibrated to **zero false accepts** on 1068 real captures — and the
current contract throws it away (see Part 5 critique).

**d. Measured distribution** (1068 real captures, Vision arm, shipped
profile — replayed today from the eval dump):

| top-1 fused score | .4–.5 | .5–.6 | .6–.7 | .7–.8 | .8–.9 | ≥.9 |
|---|---|---|---|---|---|---|
| correct top-1 (1064) | 6 | 27 | 112 | 353 | 559 | 7 |
| wrong top-1 (4) | 0 | 2 | 1 | 1 | 0 | 0 |

Margins: correct p10/p50/p90 = 0.17 / 0.31 / 0.38; the four wrong ones ≤
0.014. **Absolute score does not separate right from wrong (a wrong answer
can score 0.75); margin does.** If DexFlip sorts its review queue by anything,
sort by margin (or by tier, then margin), not by top confidence. `Candidate`
carries only per-candidate confidence — the margin is the difference of the
first two, so it is recoverable from the array, but see the critique.

## G5. Names offline [BLOCKING]

**a. Yes.** The bundled index carries the display name for all 19,448 cards
(100% coverage, verified by query), plus collector number (99.9%), set name,
set total, and HP — offline, 3.2 MB of JSON.

**b.** Both forms are available. The delivered service formats
`"Charizard — Base Set 4/102"`; the bare `"Charizard"` is one field away. For
the capture-moment banner the bare name is right; for the review strip the
set-qualified form is what makes near-identical reprints tappable — the
engine's hardest confusions are same-name same-art reprints, so a strip of
three bare "Charizard"s would be unusable.

## G6. Candidates and ties

**a.** The delivered service returns up to 6. Internally 50 are reranked;
beyond ~6 the tail is noise-ordered near-ties of the embedding distance.
Anything in your 3–10 window is fine — say the word and it's a constant.

**b.** Strictly descending by fused score, ties broken by embedding distance
(deterministic total order).

**c. Near-identical prints: both are returned, ranked.** This case is the
engine's whole reason for having OCR signals — same art in two sets fuses
within ~0.02 of each other on image alone, and the collector-number read is
usually what splits them. When OCR read nothing, both appear with a thin
margin and the tier says review; the engine never collapses printings. (Also:
digital-only reprints — TCG Pocket — are excluded from the index outright, so
a physical card's digital twin can't eat its margin.)

## G7. Shipping artefacts and size

**a.** Four artefacts:
1. **Swift source** (`dexflip-port/Sources/PokeSortRecognition/`, 7 files) —
   the contract types, the pipeline actor, and faithful ports of the fusion,
   gate, and OCR parsers. No third-party code.
2. **Index** (`dexflip-port/index/`): `cards.json` 3.2 MB + two f16 embedding
   files, 29.9 MB each — **63 MB total**, 19,448 cards, built today from the
   live catalog by `scripts/export-dexflip-index.ts`.
3. **The embedding model — the one artefact that does not exist yet.** Today
   it is a 100 MB q8 ONNX running under transformers.js. iOS needs a Core ML
   conversion of `google/siglip-base-patch16-512`'s vision tower (fp16
   ~185 MB; quantisation can pull it toward ~50–100 MB but must be re-validated
   against the eval set, because the gate constants sit near measured cliffs).
4. **This document + README** (constraints, parity plan).

**b.** App-size impact: 63 MB index + model. Realistic total **~150–250 MB**
until the model is quantised and measured. That is a real App Store number
and worth flagging to whoever owns download size.

**c. Zero third-party dependencies.** The port lands on Vision (OCR), Core ML
(embedding), Accelerate (retrieval), CoreImage/ImageIO (decode/warp) — all
first-party. This is the happy surprise of the port: Tesseract, ONNX Runtime,
sharp, and Postgres all dissolve into Apple frameworks. (The retrieval index
is brute-force cosine over 19,448×768 — single-digit ms with Accelerate; no
vector-DB dependency needed.)

**d. Versioning:** the index embeds an identity header (model, dtype,
preprocessing version, art-window version) — the sorter refuses incompatible
packs on import and DexFlip should refuse at build time the same way. New
set: sync catalog from TCGdex → embed new cards → re-export → ship with the
next release. Catalog is current through me05 (2026-07-17). TCGdex has new
sets at/near release day; the effective lag is your release cadence.

**⚠ The constraint that owns this section: embeddings are only comparable to
embeddings made by the same pipeline.** The exported vectors match the ONNX
q8 embedder. A Core ML conversion will produce *slightly different* vectors,
and nothing will fail loudly — distances just degrade across the board
(`embedding-identity.ts` exists precisely because this class of bug is
silent). So step 3 is really: convert the model, then **re-embed the catalog
with the converted model and re-export the index**, then re-run the eval.
Budget the port that way; do not ship the ONNX-derived index against a Core
ML embedder on vibes.

## G8. Swift 6 strict concurrency

**a. Yes.** The delivered `PokeSortRecognitionService` is `Sendable`; the
pipeline lives in an actor (`CardIdentifier`); the index is immutable after
load.

**b. Concurrent calls: yes.** Calls interleave at the actor's await points;
Vision and Core ML are internally thread-safe. One deliberate serialisation
survives: the remembered 180°-orientation preference is actor state (in the
sorter it is process-global — cards come off one stack; for a user shooting a
pile the same locality holds).

**c. Yes — load once, reuse.** Expensive state is the Core ML model compile
and the 60 MB index map (~1–2 s together). Construct the service once at app
start off the main actor; the convenience init does exactly this. Do not
create it per call.

## G9. Speed and warm-up

Measured today, full pipeline through `identifyCard`, M-series Mac, the
*Node/ONNX-CPU* incarnation: **warm p50 1.09 s, p95 1.22 s, max 1.27 s; cold
start +1.6 s** (150-capture run, live pricing off). Where it goes: two SigLIP
forward passes (whole card + art window) dominate; Vision OCR is tens of ms
(6.6× faster than the Tesseract it replaced); retrieval and fusion are
negligible.

**a.** iPhone numbers do not exist yet (no Core ML model — see G7). Directional
estimate, clearly labelled as such: SigLIP-base on the ANE typically runs an
order of magnitude faster than CPU ONNX, so ~0.3–0.6 s warm is plausible.
Measure when the model exists; your fire-and-forget design means even the
1 s figure would not block the shutter.

**b.** First-call cost is real: model compile + index load, ~1–2 s expected.
Pay it at app launch (G8c), not on the first card.

**c. Cancellation: yes, cooperatively.** The port checks `Task.checkCancellation`
between stages (notably before the 180° retry — the expensive half of a bad
capture, which is exactly the case a retake produces). A cancelled call
abandons at the next checkpoint; a single Core ML forward pass (~hundreds of
ms) is the largest uncancellable unit.

## G10. Failure reporting

**a.** Empty-array-as-whiff is acceptable and matches the engine's own
philosophy (OCR failure degrades ranking rather than erroring; a no-match is
an ordinary outcome).

**b.** The distinction that actually matters operationally is not
"whiff vs crash" — it is **"accept vs review"** (G4c), and the current
contract can't express either. A crash in this engine is a bug, not a
weather condition; log it locally in debug builds and move on. But if you
widen the contract for anything, widen it for the tier (see critique). One
concrete trap the contract *does* create: a systematic failure (missing model
file, corrupt index) manifests as 100% whiffs, indistinguishable from bad
lighting, in an app with no telemetry by policy. Cheap mitigation: the
service init throws — treat init failure as a build error surfaced in QA, so
the silent-whiff mode can only be transient.

## G11. Index coverage

**a.** All English TCGdex sets with card images: 21,714 cards across 163
synced sets (218 in the set index), Base through Mega Evolution (me05, July
2026), minus 1,649 digital-only TCG Pocket cards and ~2,000 more excluded
with them, leaving 19,448 identifiable physical prints. Trainer kits, POP
series, McDonald's promos, and World Championship sets are in. Cards TCGdex
has no image for (mostly old trainers/energies) are absent — they were never
embedded and cannot be matched.

**b.** TCGdex is community-maintained but has had images at or near release
day for recent sets; the binding lag is re-embed + App Store release. Same-week
coverage of a new set is realistic if you ship then.

**c. Known weak spots**, from the sorter's eval history:
- **Same-art reprint pairs** when OCR can't read the number — the dominant
  residual failure; ends in review, not misidentification.
- **HGSS-era** used to be the worst (74% top-1); the art-window blend and
  Vision OCR fixed it (98/99 numbers read). Watch it anyway on handheld glare.
- **Foil/textured surfaces** defeat *Tesseract*; Vision reads them well.
  Handheld glare on holos is still the top candidate for new failures.
- **Japanese cards** were never fed in — behaviour unmeasured; expect
  embedding-only matches to the English print (a wrong *id* for your listing,
  arguably) or whiffs. If Japanese cards are common in your users' piles,
  measure this early.
- **First Edition stamps and variants**: deliberately out of scope (the
  sorter detects the stamp; the port drops it since DexFlip owns variants).

## G12. Smaller images

**a. Yes — trivially, and no measurement is needed to unblock your decision.**
The engine's entire measured history is at **745×1043**, i.e. *smaller* than
what survives your 2560px cap. A 2560-long-edge frame with your framing guide
yields a card region ~950×1330 — comfortably above the known-good input.

**b.** Consequence: DexFlip can lower capture resolution today. The real
floor (how far *below* 745 accuracy holds) is unmeasured; if you want to
chase 1080p capture, that is a one-day eval with the harness in this repo.
Also note the engine never needs the 12 MP original — if the quad is routed
in, the stored 2560px copy is a strictly sufficient source for the crop.

---

# Contract critique (Part 5, item 5)

1. **`identify(Data)` hides the geometry the engine needs most.** You already
   run rectangle detection and discard the quad; the engine's accuracy was
   earned on deskewed crops. Amend the contract to carry the quad (or the
   warped crop). This is the one change that is architectural on your side —
   everything else below is additive.
2. **The tier is the engine's most valuable output and the contract drops
   it.** Accept vs review is calibrated to zero false accepts on 1068 real
   captures; your review screen is the natural consumer ("needs a look" vs
   "spot-check"). One added field (`enum Verdict { accept, review }` or even
   the raw margin) on the result would let the queue triage itself. Without
   it, sorting by top confidence will *feel* right and quietly rank a
   confident-wrong 0.75 above a correct-but-cautious 0.65 (measured: wrong
   answers score up to 0.8; only margin separates them).
3. **"Confidence is comparable across cards" is almost true — margin is the
   comparable thing.** If the queue ordering matters, order on
   `top.confidence − second.confidence`, which the returned array already
   lets you compute. Document that on your side of the seam.
4. **"Never on the back image" is right and worth keeping** — the index only
   contains fronts; a back is a guaranteed whiff that costs a full pipeline
   run.
5. **One-shot persistence + stub engines is a footgun you already noticed.**
   Since results are never recomputed, consider persisting an engine/index
   version alongside the candidates so a future "re-identify with the new
   index" migration is *possible*, even if never built. It is one string
   column now versus an unfixable archive later. (The sorter records exactly
   this, for exactly that reason.)
6. **`displayName` in `Candidate` couples the index to the UI locale.** Fine
   for v1 (ids are locale-neutral, names are English), but when other
   languages arrive the name belongs to a lookup on your side. No action now;
   just don't build on the assumption that displayName is stable across index
   versions.

# What was delivered, and what is honestly not done

Delivered in `dexflip-port/`: the Swift reference implementation (contract
conformance + pipeline actor + faithful ports of fusion/gating/parsers, all
first-party frameworks), the exported 63 MB index (built today from the live
catalog), the export script, and this document.

Not done, in dependency order, with owners to agree:
1. **Core ML conversion** of the SigLIP vision tower (coremltools, needs a
   Python env; ~a day including compile-time preprocessing).
2. **Catalog re-embed with the converted model + index re-export** (the G7
   comparability constraint; mechanical, ~40k forward passes).
3. **Parity harness**: run the 1068-capture eval through the Swift pipeline
   and confirm it reproduces 99.6% / 98.2% / 0 false accepts before any
   handheld variable enters.
4. **Handheld eval**: ~200 labelled captures through DexFlip's real capture
   path — the number that answers G1e and validates your ≤20%/≤5% targets.
   Until this exists, no handheld accuracy claim should ship.
