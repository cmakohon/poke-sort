# poke-sort → DexFlip port

The sorter's card-identification engine, restructured for iOS. Read the gate
answers that accompany this directory first — several of them change what
DexFlip builds.

## What the engine actually is

Not a classifier. Four cooperating parts:

1. **SigLIP image embedding** (`Xenova/siglip-base-patch16-512`, q8 ONNX,
   768-dim) of the whole card, plus a second embedding of the art window
   (top 12–55% of the card) — blended 75/25.
2. **Nearest-neighbour retrieval** over 19,448 English physical-print cards
   (cosine distance, top 50 under a 0.3 cutoff).
3. **Apple Vision OCR** — one whole-card read for the collector number, banded
   crops for name and HP. (`VNRecognizeTextRequest`, `.accurate`,
   `usesLanguageCorrection = false`.)
4. **Signal fusion + gate**: weighted mean over the informative signals
   (embedding 0.5, name 0.15, number 0.2, set code 0.05, denominator 0.02,
   HP 0.05), renormalised over what OCR actually read; accept / review /
   no-match tiers.

All measured numbers were earned on **745×1043 deskewed upright card crops**
(the sorter perspective-warps the camera frame before the engine ever sees it).
That is the input contract; see gate answer G1.

## Directory contents

```
Sources/PokeSortRecognition/
  RecognitionService.swift   DexFlip's contract + PokeSortRecognitionService
  CardIdentifier.swift       actor: embed → retrieve → OCR → fuse, 180° retry
  Fusion.swift               port of rerank.ts (scoring, fusion, tier gate)
  OcrParsing.swift           port of ocr.ts parsers (number/HP/name)
  VisionOcr.swift            Vision reads, band geometry from profiles.ts
  CardIndex.swift            f16 index loader + Accelerate brute-force search
  Embedder.swift             CardEmbedder protocol + Core ML SigLIP (see status)
scripts/
  export-dexflip-index.ts    builds index/ from the sorter's catalog
index/
  cards.json                 19,448 cards: id, name, number, total, hp, set (3.2 MB)
  embeddings.f16             whole-card vectors, unit-norm f16 (29.9 MB)
  art-embeddings.f16         art-window vectors, zero row = none (29.9 MB)
```

## Status — read this before wiring anything up

**Done and faithful to the measured pipeline:** fusion, parsers, tier gate,
band/window geometry, retrieval semantics, orientation retry, index export.

**Done 2026-08-31 — the Core ML model** (`SigLIP-vision.mlpackage`, 178 MB
fp16 mlprogram, iOS17+ target, preprocessing baked in, converted via
`torch.export` — `jit.trace` fails on the pooling head's MultiheadAttention).
Two measured facts that MUST survive into the app:

- **Never run it with `computeUnits = .all`.** SigLIP's attention overflows
  the ANE's fp16 arithmetic and the embedding is silently garbage (cosine vs
  fp32 truth 0.53–0.76). On `.cpuAndGPU` it is faithful (0.99999) and fast
  (~80 ms/pass on an M-series GPU). `Embedder.swift` pins this.
- **The bundled index is NOT usable with this model — re-embed confirmed
  required.** Measured on 24 real captures against the exported index:
  query embeddings differ from the ONNX-q8 ones by up to 0.016 cosine
  distance, worst per-candidate |Δd| 0.029 — **bigger than the whole 0.02
  `distanceGap` notch** — top-50 overlap dips to 76%, and the top-1 catalog
  match changes on 2/24 captures. Exactly the silent degradation
  `embedding-identity.ts` warns about.

**Not done, and blocking real accuracy:**

1. **Re-embed the catalog with the Core ML model** and re-run
   `export-dexflip-index.ts`. The catalog stores vectors, not images, so this
   means re-fetching ~19.5k card renders from TCGdex (the sync already knows
   the URLs) and running them through the mlpackage — a few hours of pipeline,
   then bump the index identity (`model: coreml-fp16`) so a mismatched pair
   can never ship.
2. **No handheld-photo accuracy number exists.** Every figure below is from
   the sorter's fixed webcam. The port needs its own eval set: ~200 handheld
   captures through DexFlip's own capture path, labelled, run through the
   parity harness. The sorter's eval tooling (`eval/capture-signals.ts`,
   `eval/tune.ts`) is reusable for the replay half.
3. **Two deliberate divergences to parity-test:** Vision gets raw (not
   greyscale-normalised) name/HP crops, and the Tesseract fallback +
   escalation ladder are dropped entirely (iOS always has Vision).

## Adding to the Xcode project

1. Drop `Sources/PokeSortRecognition/` into DexFlip's
   `Services/Recognition/`. First-party frameworks only: Vision, Core ML,
   CoreImage, Accelerate, ImageIO.
2. Add the three `index/` files to the target as bundle resources (no asset
   catalog; `CardIndex` loads them by name, memory-mapped).
3. Add `SigLIP-vision.mlpackage`. It is gitignored (177 MB weight file; LFS
   is unavailable on this fork) — download it from the
   `dexflip-port-model-v1` GitHub release, or rebuild it byte-for-byte with
   `scripts/convert_siglip.py`. Load with `.cpuAndGPU`, never `.all`.
4. Construct once at startup, off the main actor:
   `let service = try PokeSortRecognitionService(modelURL: ...)` — this pays
   index load + model compile (~1–2 s) so the first shutter press doesn't.
5. The entry point is the pinned contract (DexFlip interface pin,
   2026-08-31): `identify(_ image: CGImage, quad: CardQuad) async ->
   Identification`. DexFlip passes upright sRGB pixels with the card's long
   axis vertical and a normalized **top-left-origin, y-down** quad; the
   engine flips y exactly once (in `deskew`), warps to 745×1043, and owns the
   180° ambiguity. Returns up to 6 candidates plus the
   accept/review/no-match verdict; `candidates.isEmpty == (verdict ==
   .noMatch)`. `versionTag` is derived from the index's embedding identity +
   card count + an engine revision constant — persist it per card as the pin
   says. There is no full-frame/`Data` entry point and no internal rectangle
   detection: finding the card is DexFlip's job.

## Numbers (sorter hardware/captures — the honest baseline)

- Real-capture eval, 1068 handfed webcam captures at 745×1043, Vision OCR:
  **top-1 99.6%**, accept tier 98.2% (all correct), review 1.8%, **0 false
  accepts**, 0 no-match.
- Score distribution (same run): correct top-1 fused scores cluster 0.7–0.9;
  the 4 wrong top-1s score 0.5–0.8 but with margins ≤0.014 against the
  median correct margin 0.31 — **margin, not absolute score, is the
  discriminator**.
- Latency, M-series Mac, Node/ONNX-CPU path, full pipeline: warm p50 1.09 s /
  p95 1.22 s; cold start +1.6 s (model + OCR pool load). iPhone with the
  embedder on the ANE should beat the embedding share of that substantially —
  unmeasured until the Core ML model exists.
- Artefact weight: index 63 MB + model ~100 MB (ONNX q8 today; Core ML fp16
  ~185 MB before compression) → expect **~150–250 MB** added to the app until
  the model is quantised, then measure.

## Versioning / new sets

The index is a build artefact of the sorter's catalog, which syncs from
TCGdex. New set → sync catalog → embed new cards → re-run the export → ship
with the next App Store release. The catalog here is current through
me05 "Pitch Black" (2026-07-17). TCGdex itself typically has images at or
near release day; the practical lag is your release cadence, not the data's.
